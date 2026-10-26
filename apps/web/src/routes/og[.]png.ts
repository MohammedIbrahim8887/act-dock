import { createFileRoute } from '@tanstack/react-router'
import { renderCard } from '@/og/render'
export const Route = createFileRoute('/og.png')({
  server: { handlers: { GET: ({ request }) => renderCard(request) } },
})
