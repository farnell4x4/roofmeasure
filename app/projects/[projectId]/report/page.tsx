import { ProjectReportPage } from "@/components/report/ProjectReportPage";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectReportRoute({ params }: Props) {
  const { projectId } = await params;
  return <ProjectReportPage projectId={projectId} />;
}
