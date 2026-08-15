import { ProcessingToolsPanel, type ProcessingToolsPanelProps } from "../components/ProcessingToolsPanel";

export type SourceUploadSurfacesIslandProps = ProcessingToolsPanelProps;

export function SourceUploadSurfacesIsland(props: SourceUploadSurfacesIslandProps) {
  return (
    <section
      className="source-upload-surfaces-island"
      data-source-upload-surfaces-island="1"
      aria-label="Source upload surfaces island"
    >
      <ProcessingToolsPanel {...props} colorReferenceInputIdPrefix="source-island-color-ref-input" />
    </section>
  );
}
