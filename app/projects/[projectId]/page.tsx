import { WorkspacePage } from "@/components/workspace/WorkspacePage";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectWorkspaceRoute({ params }: Props) {
  const { projectId } = await params;
  return <WorkspacePage projectId={projectId} />;
}
