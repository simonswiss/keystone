import { DocsLayout } from '../../../components/docs/DocsLayout'
import PageClient from './page-client'

export const metadata = {
  title: 'Timeline',
  description: 'A snapshot of Keystone improvements and community happenings.',
}

export default function Timeline () {
  return (
    <DocsLayout noRightNav noProse isIndexPage>
      <PageClient />
    </DocsLayout>
  )
}
