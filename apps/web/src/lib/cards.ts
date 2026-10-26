import type { CardContent } from '../../scripts/og/card'
// Social card copy, rendered to public/og/<name>.png at build time. Use \n for a line break.
export const cards = {
  home: { eyebrow: 'Local GitHub Actions runner', title: 'Your pipelines.\nOn your machine.', subtitle: 'Run workflows locally, follow every step, and give your AI agents the same controls.' },
  docs: { eyebrow: 'Documentation', title: 'Run GitHub Actions\non your machine.', subtitle: 'Install Act Dock, connect your agents over MCP, and drive the runner from the CLI.' },
} satisfies Record<string, CardContent>
export type CardName = keyof typeof cards
