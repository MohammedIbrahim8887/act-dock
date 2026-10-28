import { actContainerName } from "./workflow-analysis";
import type { Store } from "./store";
import type { Images } from "./images";
import type { Run } from "../shared/contracts";

type Container = {
  Id: string;
  Name: string;
  Created: string;
  Config: { Image: string; Labels?: Record<string, string> };
  Mounts?: { Type: string; Name: string }[];
  NetworkSettings?: { Networks?: Record<string, { NetworkID: string }> };
};
/** Creation events plus a verified parent connect unlabelled resources to a run.
 * A missing proof remains visible and is never a reason to delete by name alone.
 */
export class Ownership {
  constructor(
    readonly store: Store,
    readonly fingerprint: (name: string) => Promise<string>,
  ) {}
  save(id: string, runId: string, data: Record<string, unknown>) {
    this.store.db
      .query(
        "INSERT INTO resources VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE resources.run_id=excluded.run_id AND json_extract(resources.data,'$.kind') LIKE 'ambiguous-%' AND json_extract(excluded.data,'$.kind') NOT LIKE 'ambiguous-%'",
      )
      .run(id, runId, JSON.stringify(data));
  }
  known(id: string) {
    return !!this.store.db
      .query(
        "SELECT id FROM resources WHERE id=? AND json_extract(data,'$.kind') NOT LIKE 'ambiguous-%'",
      )
      .get(id);
  }
  async privateWorkspaceExists(data: { nameHashes: string[] }, images: Images) {
    const names = (
      await images.command(["volume", "ls", "--format", "{{.Name}}"], 5000)
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const name of names)
      if (data.nameHashes.includes(await this.fingerprint(name))) return true;
    return false;
  }
  async created(images: Images, kind: string, id: string, run: Run) {
    try {
      const text = (
        await images.command(
          [
            "events",
            "--since",
            run.startedAt || run.createdAt,
            "--until",
            new Date().toISOString(),
            "--filter",
            `type=${kind}`,
            "--filter",
            "event=create",
            "--filter",
            `${kind}=${id}`,
            "--format",
            "{{json .}}",
          ],
          5000,
        )
      ).stdout;
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .some((line) => {
          const event = JSON.parse(line);
          return (
            (event.Actor?.ID || event.id) === id &&
            (event.Action || event.status) === "create"
          );
        });
    } catch {
      return false;
    }
  }
  async capture(run: Run, parent: Container, images: Images) {
    if (parent.Config?.Labels?.["act-dock.run"] !== run.id) return;
    const name = parent.Name.replace(/^\//, "");
    if (run.snapshot?.resourceExpectations?.privateNames) {
      this.save(`private-workspace:${parent.Id}`, run.id, {
        kind: "private-workspace",
        parent: parent.Id,
        nameHashes: await Promise.all(
          [name, name + "-env"].map((value) => this.fingerprint(value)),
        ),
      });
    }
    for (const mount of run.snapshot?.resourceExpectations?.privateNames
      ? []
      : parent.Mounts || []) {
      if (
        mount.Type !== "volume" ||
        ![name, name + "-env"].includes(mount.Name) ||
        this.known(`volume:${mount.Name}`)
      )
        continue;
      try {
        const volume = JSON.parse(
          (await images.command(["volume", "inspect", mount.Name], 5000))
            .stdout,
        )[0];
        if (
          Date.parse(volume.CreatedAt) <
          Date.parse(run.startedAt || run.createdAt)
        )
          continue;
        const proven = await this.created(images, "volume", mount.Name, run);
        this.save(`volume:${mount.Name}`, run.id, {
          kind: proven ? "volume" : "ambiguous-volume",
          name: mount.Name,
          createdAt: volume.CreatedAt,
          parent: parent.Id,
        });
      } catch {}
    }
    const networks = new Map(
      Object.entries(parent.NetworkSettings?.Networks || {}).map(
        ([name, attachment]) => [name, attachment.NetworkID],
      ),
    );
    // Act's host-network job container need not join its service network.
    for (const expected of run.snapshot?.resourceExpectations?.networks || [])
      if (expected.startsWith(name + "-")) networks.set(expected, expected);
    for (const [networkName, networkId] of networks) {
      if (!networkName.startsWith(name + "-") || !networkId) continue;
      try {
        const network = JSON.parse(
          (await images.command(["network", "inspect", networkId], 5000))
            .stdout,
        )[0];
        if (
          Date.parse(network.Created) <
          Date.parse(run.startedAt || run.createdAt)
        )
          continue;
        const proven =
          this.known(`network:${network.Id}`) ||
          (await this.created(images, "network", network.Id, run));
        this.save(`network:${network.Id}`, run.id, {
          kind: proven ? "network" : "ambiguous-network",
          id: network.Id,
          nameHash: await this.fingerprint(network.Name),
          createdAt: network.Created,
          parent: parent.Id,
        });
        const services = run.snapshot?.resourceExpectations?.services || [];
        for (const [id, member] of Object.entries(network.Containers || {}) as [
          string,
          { Name: string },
        ][]) {
          if (id === parent.Id || this.known(id)) continue;
          const expected = services.find(
            (service) => actContainerName(name, service.id) === member.Name,
          );
          const container = JSON.parse(
            (await images.command(["container", "inspect", id], 5000)).stdout,
          )[0] as Container;
          const valid =
            expected &&
            container.Config.Image === expected.image &&
            Date.parse(container.Created) >=
              Date.parse(run.startedAt || run.createdAt) &&
            (await this.created(images, "container", id, run));
          this.save(id, run.id, {
            kind: valid ? "service-container" : "ambiguous-container",
            id,
            nameHash: await this.fingerprint(container.Name),
            imageHash: valid
              ? await this.fingerprint(container.Config.Image)
              : undefined,
            createdAt: container.Created,
            parent: parent.Id,
          });
        }
      } catch {}
    }
  }
}
