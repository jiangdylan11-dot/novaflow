(function registerPrimaryEntryTransitionBridge(root) {
  "use strict";

  function create() {
    const state = {
      phase: "idle",
      sourceIndex: -1,
      targetIndex: -1,
      token: -1,
      reason: "init"
    };

    const clear = (reason) => {
      state.phase = "idle";
      state.sourceIndex = -1;
      state.targetIndex = -1;
      state.token = -1;
      state.reason = String(reason || "clear");
    };

    return Object.freeze({
      begin({ sourceIndex, targetIndex } = {}) {
        const source = Number(sourceIndex);
        const target = Number(targetIndex);
        if (!Number.isInteger(source) || !Number.isInteger(target) || source < 0 || target < 0 || source === target) {
          return false;
        }
        if (state.phase !== "idle") return false;
        state.phase = "pending";
        state.sourceIndex = source;
        state.targetIndex = target;
        state.token = -1;
        state.reason = "intent";
        return true;
      },

      bind(token) {
        const nextToken = Number(token);
        if (state.phase !== "pending" || !Number.isInteger(nextToken) || nextToken < 0) return false;
        if (state.token >= 0) return state.token === nextToken;
        state.token = nextToken;
        state.reason = "bound";
        return true;
      },

      isPending(expectedToken = null) {
        if (state.phase !== "pending" && state.phase !== "committing") return false;
        if (expectedToken === null || expectedToken === undefined) return true;
        return state.token >= 0 && state.token === Number(expectedToken);
      },

      resolvePublishedIndex(requestedIndex) {
        const requested = Number(requestedIndex);
        if (state.phase === "pending" && requested === state.targetIndex) {
          return state.sourceIndex;
        }
        return requested;
      },

      claimCommit(token) {
        const expectedToken = Number(token);
        if (state.phase !== "pending" || state.token < 0 || state.token !== expectedToken) return false;
        state.phase = "committing";
        state.reason = "commit-claimed";
        return true;
      },

      complete(token, reason = "mounted") {
        if (state.phase !== "committing" || state.token !== Number(token)) return false;
        clear(reason);
        return true;
      },

      cancel({ expectedToken = null, reason = "cancel" } = {}) {
        if (state.phase === "idle") return false;
        if (
          expectedToken !== null &&
          expectedToken !== undefined &&
          (state.token < 0 || state.token !== Number(expectedToken))
        ) {
          return false;
        }
        clear(reason);
        return true;
      },

      snapshot() {
        return {
          phase: state.phase,
          sourceIndex: state.sourceIndex,
          targetIndex: state.targetIndex,
          token: state.token,
          reason: state.reason
        };
      }
    });
  }

  root.NovaFlowPrimaryEntryTransitionBridge = Object.freeze({ create });
})(typeof window !== "undefined" ? window : globalThis);
