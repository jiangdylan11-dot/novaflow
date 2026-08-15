import { forwardRef } from "react";

export const LegacyRuntimeFrame = forwardRef<HTMLIFrameElement>(function LegacyRuntimeFrame(_, ref) {
  return (
    <iframe
      ref={ref}
      className="legacy-runtime-frame"
      data-legacy-runtime-frame="1"
      title="NovaFlow legacy bridge"
      src="/legacy-bridge.html"
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
    />
  );
});
