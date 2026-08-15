import { LegacyRuntimeFrame } from "./LegacyRuntimeFrame";
import type { RefObject } from "react";

type Props = {
  legacyFrameRef: RefObject<HTMLIFrameElement | null>;
};

export function LegacyRuntimeMount({ legacyFrameRef }: Props) {
  return (
    <section className="legacy-runtime-mount" data-legacy-runtime-mount="iframe-only">
      <div className="legacy-runtime-mount__header">
        <div>
          <p className="source-shell__kicker">Legacy Runtime Container</p>
          <h2>Locked bundle boundary</h2>
        </div>
        <span data-legacy-runtime-policy="iframe-only">iframe only</span>
      </div>
      <LegacyRuntimeFrame ref={legacyFrameRef} />
    </section>
  );
}
