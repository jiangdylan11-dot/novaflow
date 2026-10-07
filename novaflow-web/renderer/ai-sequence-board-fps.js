(function (root) {
  'use strict';
  const clamp = (value, fallback = 30) => {
    const number = Number(value);
    return Math.max(1, Math.min(120, Number.isFinite(number) && number > 0 ? number : fallback));
  };
  const rate = value => {
    if (typeof value === 'string' && value.includes('/')) {
      const [n, d] = value.split('/').map(Number);
      return Number.isFinite(n) && Number.isFinite(d) && d > 0 && n > 0 ? n / d : null;
    }
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  function metadata(value = {}) {
    const fps = rate(value.fpsExpr || value.avg_frame_rate) || rate(value.fps) || rate(value.r_frame_rate);
    return {
      sourceFps: fps,
      sourceFrames: Number(value.frames) > 0 ? Math.round(Number(value.frames)) : undefined,
      sourceDurationSec: Number(value.durationSec) > 0 ? Number(value.durationSec) : undefined,
      sourceRateMode: value.rateMode || 'unknown',
      sourceFpsOrigin: value.fpsOrigin || (fps ? 'probe' : 'unavailable')
    };
  }
  function effective(board, fallback = 30) {
    return clamp(board?.timelineFps ?? board?.loadedVideo?.sourceFps, fallback);
  }
  function framePlan(board, durationSec, fallback = 30, lockFallback = false) {
    const video = board?.loadedVideo || {};
    const fps = effective(board, fallback), sourceFps = rate(video.sourceFps) || fps;
    const duration = Math.max(.01, Number(video.sourceDurationSec) || Number(durationSec) || Number(video.sourceFrames) / sourceFps || .01);
    const locked = board?.keepDuration ?? lockFallback;
    const count = Math.max(1, Math.round(locked ? duration * fps : Number(video.sourceFrames) || duration * sourceFps));
    const sampleFps = locked ? fps : sourceFps;
    const times = Array.from({ length: count }, (_, index) => Math.min(duration, index / sampleFps));
    return { fps, sourceFps, sampleFps, count, times, locked, sourceUrl: video.objectUrl, boardId: board?.id, sourceDurationSec: duration,
      durationSec: locked ? duration : count / fps, playbackRate: locked ? 1 : fps / sourceFps };
  }
  function rateInfo(video) {
    if (!video?.objectUrl) return '此帧率仅作用于当前画板';
    if (!(Number(video.sourceFps) > 0)) return '无法读取原始帧率，沿用当前画板值；手动调整后以调整值为准';
    if (video.sourceRateMode === 'variable') return `变帧率视频，使用探测平均值 ${video.sourceFps} 初始化；以当前画板帧率播放和导出`;
    if (video.sourceFpsOrigin === 'ffmpeg-stream-log') return `原始帧率探测值 ${video.sourceFps}（日志精度，无法确认恒定帧率）；以当前画板值为准`;
    return `源视频帧率 ${video.sourceFps}；以当前画板值播放和导出`;
  }
  // Import tickets are captured before any asynchronous read. Manual edits are
  // recorded immediately, so a later metadata result cannot win a React batch.
  function createController() {
    let context = null, epoch = 0, serial = 0;
    const revisions = new Map(), imports = new Map(), manualFps = new Map();
    const update = patch => context?.setBoards(boards => boards.map(board => board.id === patch.id ? { ...board, ...patch } : board));
    return {
      connect(next) {
        if (context?.activeId !== next.activeId) epoch += 1;
        context = next;
      },
      beginImport() {
        if (!context) return null;
        const ticket = { id: context.activeId, epoch, serial: ++serial, revision: revisions.get(context.activeId) || 0 };
        imports.set(ticket.id, ticket.serial);
        return ticket;
      },
      cancelPending() { epoch += 1; },
      currentPlan(durationSec) {
        const board = context?.boards.find(board => board.id === context.activeId);
        return board ? framePlan(board, durationSec, context.legacyFps, context.legacyLock) : null;
      },
      isCurrent(ticket) {
        return !!ticket && context?.activeId === ticket.id && ticket.epoch === epoch && imports.get(ticket.id) === ticket.serial;
      },
      commitImport(ticket, video) {
        if (!this.isCurrent(ticket)) return null;
        const board = context.boards.find(board => board.id === ticket.id);
        if (!board) return null;
        const source = { ...video, ...metadata({ fps: video.sourceFps, frames: video.sourceFrames, durationSec: video.sourceDurationSec,
          rateMode: video.sourceRateMode, fpsOrigin: video.sourceFpsOrigin }) };
        const edited = (revisions.get(ticket.id) || 0) !== ticket.revision;
        const fps = edited ? manualFps.get(ticket.id) || effective(board) : clamp(source.sourceFps, effective(board));
        update({ id: ticket.id, timelineFps: fps, fpsUserEdited: edited, loadedVideo: source });
        return source;
      },
      setFps(value) {
        if (!context) return;
        const board = context.boards.find(board => board.id === context.activeId);
        const fps = clamp(typeof value === 'function' ? value(effective(board)) : value);
        revisions.set(context.activeId, (revisions.get(context.activeId) || 0) + 1);
        manualFps.set(context.activeId, fps);
        update({ id: context.activeId, timelineFps: fps, fpsUserEdited: true });
      },
      setLocked(value) {
        if (!context) return;
        const board = context.boards.find(board => board.id === context.activeId);
        update({ id: context.activeId, keepDuration: typeof value === 'function' ? !!value(board?.keepDuration) : !!value });
      },
      // This is metadata enrichment, never a second initialization.
      enrich(sourceUrl, meta) {
        if (!context) return;
        const fields = Object.fromEntries(Object.entries(metadata(meta)).filter(([, value]) => value != null));
        context.setBoards(boards => boards.map(board => board.loadedVideo?.objectUrl === sourceUrl
          ? { ...board, loadedVideo: { ...board.loadedVideo, ...fields } } : board));
      }
    };
  }
  const controller = createController();
  function useBoardFps(React, boards, setBoards, activeId, legacyFps = 30, legacyLock = false) {
    const board = boards.find(board => board.id === activeId);
    controller.connect({ boards, setBoards, activeId, legacyFps, legacyLock });
    return { fps: effective(board, legacyFps), locked: board?.keepDuration ?? legacyLock,
      setFps: value => controller.setFps(value), setLocked: value => controller.setLocked(value) };
  }
  root.NovaFlowAiSequenceBoardFps = { clamp, rate, metadata, effective, framePlan, rateInfo, createController, useBoardFps,
    beginImport: () => controller.beginImport(), isCurrent: ticket => controller.isCurrent(ticket),
    cancelPending: () => controller.cancelPending(),
    currentPlan: durationSec => controller.currentPlan(durationSec),
    commitImport: (ticket, video) => controller.commitImport(ticket, video), enrich: (url, meta) => controller.enrich(url, meta) };
})(typeof window !== 'undefined' ? window : globalThis);
