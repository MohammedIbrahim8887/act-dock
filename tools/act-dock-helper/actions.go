package main

import (
	"archive/tar"
	"context"
	"encoding/json"
	git "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func fetchAction(r Request) (any, error) {
	u, err := url.Parse(r.URL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || !filepath.IsAbs(r.Path) {
		return nil, fail("INVALID_ACTION")
	}
	if strings.ContainsAny(r.Ref, " :\t\r\n~^?*[\\") || strings.Contains(r.Ref, "..") || r.Ref == "" {
		return nil, fail("INVALID_ACTION_REF")
	}
	if err := os.MkdirAll(filepath.Dir(r.Path), 0700); err != nil {
		return nil, err
	}
	temp, err := os.MkdirTemp(filepath.Dir(r.Path), ".fetch-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(temp)
	repo, err := git.PlainInit(temp, false)
	if err != nil {
		return nil, err
	}
	_, err = repo.CreateRemote(&config.RemoteConfig{Name: "origin", URLs: []string{r.URL}})
	if err != nil {
		return nil, err
	}
	options := &git.FetchOptions{RemoteName: "origin", RefSpecs: []config.RefSpec{config.RefSpec("+" + r.Ref + ":refs/remotes/origin/act-dock")}, Depth: 1, Force: true, Tags: git.NoTags}
	if r.Token != "" {
		options.Auth = &http.BasicAuth{Username: "token", Password: r.Token}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err = repo.FetchContext(ctx, options); err != nil && err != git.NoErrAlreadyUpToDate {
		return nil, fail("ACTION_FETCH_FAILED")
	}
	ref, err := repo.Reference("refs/remotes/origin/act-dock", true)
	if err != nil {
		return nil, err
	}
	tree, err := repo.Worktree()
	if err != nil {
		return nil, err
	}
	if err = tree.Checkout(&git.CheckoutOptions{Hash: plumbing.NewHash(ref.Hash().String()), Force: true}); err != nil {
		return nil, err
	}
	if err = filepath.Walk(temp, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink == 0 {
			return nil
		}
		target, err := filepath.EvalSymlinks(path)
		if err != nil {
			return fail("ACTION_SYMLINK_INVALID")
		}
		rel, err := filepath.Rel(temp, target)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return fail("ACTION_PATH_ESCAPE")
		}
		return nil
	}); err != nil {
		return nil, err
	}
	os.RemoveAll(filepath.Join(temp, ".git"))
	if _, err = os.Stat(r.Path); err == nil {
		return nil, fail("CACHE_DESTINATION_EXISTS")
	}
	if err = os.Rename(temp, r.Path); err != nil {
		return nil, err
	}
	return map[string]string{"commit": ref.Hash().String()}, nil
}

// Retag an exported platform image locally, without contacting a registry.
func rewriteImage(r Request) error {
	in, err := os.Open(r.Source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(r.Path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer out.Close()
	reader := tar.NewReader(in)
	writer := tar.NewWriter(out)
	defer writer.Close()
	for {
		h, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if h.Name == "manifest.json" || h.Name == "index.json" {
			if h.Size > 4*1024*1024 {
				return fail("IMAGE_MANIFEST_TOO_LARGE")
			}
			data, err := io.ReadAll(reader)
			if err != nil {
				return err
			}
			if h.Name == "manifest.json" {
				var manifests []map[string]any
				if json.Unmarshal(data, &manifests) != nil {
					return fail("INVALID_IMAGE_ARCHIVE")
				}
				for _, m := range manifests {
					m["RepoTags"] = []string{r.Alias}
				}
				data, _ = json.Marshal(manifests)
			} else {
				var index map[string]any
				if json.Unmarshal(data, &index) != nil {
					return fail("INVALID_IMAGE_ARCHIVE")
				}
				if list, ok := index["manifests"].([]any); ok {
					for _, v := range list {
						if m, ok := v.(map[string]any); ok {
							m["annotations"] = map[string]string{"io.containerd.image.name": "docker.io/library/" + r.Alias, "org.opencontainers.image.ref.name": r.Alias}
						}
					}
				}
				data, _ = json.Marshal(index)
			}
			h.Size = int64(len(data))
			if err = writer.WriteHeader(h); err != nil {
				return err
			}
			if _, err = writer.Write(data); err != nil {
				return err
			}
		} else {
			if err = writer.WriteHeader(h); err != nil {
				return err
			}
			if _, err = io.Copy(writer, reader); err != nil {
				return err
			}
		}
	}
}
