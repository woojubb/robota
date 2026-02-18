import { DagDesignerScreen } from "../_components/dag-designer-screen";

interface IDagDesignerDetailPageProps {
  params: Promise<{ dagId: string }>;
}

export default async function DagDesignerDetailPage(props: IDagDesignerDetailPageProps) {
  const params = await props.params;
  return <DagDesignerScreen initialDagId={decodeURIComponent(params.dagId)} />;
}
