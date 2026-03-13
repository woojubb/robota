import { Suspense } from "react";
import { DagDesignerScreen } from "../_components/dag-designer-screen";

interface IDagDesignerDetailPageProps {
  params: Promise<{ dagId: string }>;
}

export default async function DagDesignerDetailPage(props: IDagDesignerDetailPageProps) {
  const params = await props.params;
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-700">Loading DAG...</div>}>
      <DagDesignerScreen initialDagId={decodeURIComponent(params.dagId)} />
    </Suspense>
  );
}
