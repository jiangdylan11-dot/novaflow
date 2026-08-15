import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AISequenceBoardSession } from "../types/aiSequenceBoardSession";
import {
  DEFAULT_BOARD_SESSION_GENERATION_PARAMETERS,
  DEFAULT_BOARD_SESSION_TIMELINE_STATE
} from "../types/aiSequenceBoardSession";
import type { ColorReference, UploadedImageState } from "../types/colorReference";
import type { GenerationParameters } from "../types/generationParameters";
import type { ImageSequenceFrame } from "../types/imageSequence";
import {
  clampTimelineFrame,
  type TimelineState
} from "../types/timeline";
import type { VideoPreviewState } from "../types/videoPreview";

type BoardSessionUpdater = (current: AISequenceBoardSession) => AISequenceBoardSession;

function createBoardId() {
  return crypto.randomUUID();
}

function createDefaultBoardSession(name: string): AISequenceBoardSession {
  return {
    id: createBoardId(),
    name,
    generationParameters: { ...DEFAULT_BOARD_SESSION_GENERATION_PARAMETERS },
    timelineState: { ...DEFAULT_BOARD_SESSION_TIMELINE_STATE },
    imageSequenceFrames: [],
    referenceImage: null,
    colorReference: null,
    videoPreview: null
  };
}

function revokeUploadedImage(value: UploadedImageState | null) {
  if (value?.url) URL.revokeObjectURL(value.url);
}

function revokeColorReference(value: ColorReference | null | undefined) {
  if (value?.objectUrl) URL.revokeObjectURL(value.objectUrl);
}

function revokeImageSequenceFrames(frames: ImageSequenceFrame[]) {
  frames.forEach((frame) => URL.revokeObjectURL(frame.url));
}

function revokeVideoPreview(value: VideoPreviewState | null) {
  if (value?.url) URL.revokeObjectURL(value.url);
}

function revokeBoardResources(board: AISequenceBoardSession) {
  revokeImageSequenceFrames(board.imageSequenceFrames);
  revokeUploadedImage(board.referenceImage);
  revokeColorReference(board.colorReference);
  revokeVideoPreview(board.videoPreview);
}

export function useAISequenceSourceState() {
  const [boards, setBoards] = useState<AISequenceBoardSession[]>([]);
  const [activeBoardId, setActiveBoardIdState] = useState<string | null>(null);
  const boardsRef = useRef<AISequenceBoardSession[]>([]);
  const activeBoardIdRef = useRef<string | null>(null);
  const playbackRafRef = useRef<number | null>(null);
  const playbackLastTimeRef = useRef<number | null>(null);

  const activeBoard = useMemo(
    () => boards.find((board) => board.id === activeBoardId) ?? null,
    [activeBoardId, boards]
  );

  const generationParameters = activeBoard?.generationParameters ?? DEFAULT_BOARD_SESSION_GENERATION_PARAMETERS;
  const timelineState = activeBoard?.timelineState ?? DEFAULT_BOARD_SESSION_TIMELINE_STATE;
  const referenceImage = activeBoard?.referenceImage ?? null;
  const colorReference = activeBoard?.colorReference ?? null;
  const videoPreview = activeBoard?.videoPreview ?? null;
  const imageSequenceFrames = activeBoard?.imageSequenceFrames ?? [];
  const playbackFrameCount = activeBoard && !activeBoard.videoPreview
    ? Math.min(activeBoard.generationParameters.frames, activeBoard.imageSequenceFrames.length)
    : 0;

  useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);

  useEffect(() => {
    activeBoardIdRef.current = activeBoardId;
  }, [activeBoardId]);

  const cancelPlaybackFrame = useCallback(() => {
    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
    playbackLastTimeRef.current = null;
  }, []);

  const updateBoardSession = useCallback((id: string, updater: BoardSessionUpdater) => {
    setBoards((current) => current.map((board) => {
      if (board.id !== id) return board;
      return updater(board);
    }));
  }, []);

  const updateActiveBoardSession = useCallback((updater: BoardSessionUpdater) => {
    const id = activeBoardIdRef.current;
    if (!id) return;
    updateBoardSession(id, updater);
  }, [updateBoardSession]);

  const stopBoardPlayback = useCallback((id: string | null) => {
    if (!id) return;
    updateBoardSession(id, (board) => ({
      ...board,
      timelineState: {
        ...board.timelineState,
        isPlaying: false
      }
    }));
  }, [updateBoardSession]);

  useEffect(() => {
    return () => {
      cancelPlaybackFrame();
      boardsRef.current.forEach(revokeBoardResources);
    };
  }, [cancelPlaybackFrame]);

  useEffect(() => {
    cancelPlaybackFrame();

    if (!activeBoardId || !timelineState.isPlaying || playbackFrameCount <= 0) {
      return;
    }

    const boardId = activeBoardId;
    const frameDuration = 1000 / Math.max(1, timelineState.fps);

    const advanceFrame = (timestamp: number) => {
      if (playbackLastTimeRef.current === null) {
        playbackLastTimeRef.current = timestamp;
      }

      const elapsed = timestamp - playbackLastTimeRef.current;
      if (elapsed >= frameDuration) {
        const steps = Math.max(1, Math.floor(elapsed / frameDuration));
        playbackLastTimeRef.current += steps * frameDuration;
        updateBoardSession(boardId, (board) => {
          const playableFrameCount = Math.min(board.timelineState.totalFrames, board.imageSequenceFrames.length);
          if (playableFrameCount <= 0) return board;
          return {
            ...board,
            timelineState: {
              ...board.timelineState,
              currentFrame: (board.timelineState.currentFrame + steps) % playableFrameCount
            }
          };
        });
      }

      playbackRafRef.current = requestAnimationFrame(advanceFrame);
    };

    playbackRafRef.current = requestAnimationFrame(advanceFrame);
    return cancelPlaybackFrame;
  }, [
    activeBoardId,
    cancelPlaybackFrame,
    playbackFrameCount,
    timelineState.fps,
    timelineState.isPlaying,
    updateBoardSession
  ]);

  const setActiveBoardId = useCallback((id: string | null) => {
    const previousId = activeBoardIdRef.current;
    if (previousId !== id) {
      cancelPlaybackFrame();
      stopBoardPlayback(previousId);
    }
    activeBoardIdRef.current = id;
    setActiveBoardIdState(id);
  }, [cancelPlaybackFrame, stopBoardPlayback]);

  const createBoard = useCallback(() => {
    const nextIndex = boardsRef.current.length + 1;
    const board = createDefaultBoardSession(`鐢绘澘 ${nextIndex}`);
    setBoards((current) => [...current, board]);
    setActiveBoardId(board.id);
  }, [setActiveBoardId]);

  const removeBoard = useCallback((id: string) => {
    const target = boardsRef.current.find((board) => board.id === id);
    if (!target) return;

    cancelPlaybackFrame();
    revokeBoardResources(target);

    const nextBoards = boardsRef.current.filter((board) => board.id !== id);
    boardsRef.current = nextBoards;
    setBoards(nextBoards);

    if (activeBoardIdRef.current === id) {
      const nextActiveBoardId = nextBoards[0]?.id ?? null;
      activeBoardIdRef.current = nextActiveBoardId;
      setActiveBoardIdState(nextActiveBoardId);
    }
  }, [cancelPlaybackFrame]);

  const updateGenerationParameters = useCallback((next: GenerationParameters) => {
    updateActiveBoardSession((board) => ({
      ...board,
      generationParameters: next,
      timelineState: {
        ...board.timelineState,
        currentFrame: clampTimelineFrame(board.timelineState.currentFrame, next.frames),
        totalFrames: next.frames,
        fps: next.fps
      }
    }));
  }, [updateActiveBoardSession]);

  const updateTimelineState = useCallback((next: TimelineState | ((current: TimelineState) => TimelineState)) => {
    updateActiveBoardSession((board) => {
      const nextTimelineState = typeof next === "function" ? next(board.timelineState) : next;
      return {
        ...board,
        timelineState: nextTimelineState
      };
    });
  }, [updateActiveBoardSession]);

  const setReferenceImage = useCallback((next: UploadedImageState | null) => {
    updateActiveBoardSession((board) => ({
      ...board,
      referenceImage: next
    }));
  }, [updateActiveBoardSession]);

  const clearReferenceImage = useCallback(() => {
    const currentBoard = boardsRef.current.find((board) => board.id === activeBoardIdRef.current);
    if (currentBoard?.referenceImage) revokeUploadedImage(currentBoard.referenceImage);
    updateActiveBoardSession((board) => ({
      ...board,
      referenceImage: null
    }));
  }, [updateActiveBoardSession]);

  const setColorReference = useCallback((next: ColorReference | null) => {
    const id = activeBoardIdRef.current;
    const currentBoard = boardsRef.current.find((board) => board.id === id);
    if (!id || !currentBoard) {
      revokeColorReference(next);
      return;
    }

    revokeColorReference(currentBoard.colorReference);
    updateBoardSession(id, (board) => ({
      ...board,
      colorReference: next
    }));
  }, [updateBoardSession]);

  const clearColorReference = useCallback(() => {
    const currentBoard = boardsRef.current.find((board) => board.id === activeBoardIdRef.current);
    if (currentBoard?.colorReference) revokeColorReference(currentBoard.colorReference);
    updateActiveBoardSession((board) => ({
      ...board,
      colorReference: null
    }));
  }, [updateActiveBoardSession]);

  const setImageSequenceFrames = useCallback((next: ImageSequenceFrame[]) => {
    const id = activeBoardIdRef.current;
    const currentBoard = boardsRef.current.find((board) => board.id === id);
    if (!id || !currentBoard) {
      revokeImageSequenceFrames(next);
      return;
    }

    cancelPlaybackFrame();
    revokeImageSequenceFrames(currentBoard.imageSequenceFrames);
    updateBoardSession(id, (board) => ({
      ...board,
      imageSequenceFrames: next,
      generationParameters: {
        ...board.generationParameters,
        frames: next.length
      },
      timelineState: {
        ...board.timelineState,
        currentFrame: 0,
        totalFrames: next.length,
        isPlaying: false
      }
    }));
  }, [cancelPlaybackFrame, updateBoardSession]);

  const clearImageSequenceFrames = useCallback(() => {
    const id = activeBoardIdRef.current;
    const currentBoard = boardsRef.current.find((board) => board.id === id);
    if (!id || !currentBoard) return;

    cancelPlaybackFrame();
    revokeImageSequenceFrames(currentBoard.imageSequenceFrames);
    updateBoardSession(id, (board) => ({
      ...board,
      imageSequenceFrames: [],
      timelineState: {
        ...board.timelineState,
        currentFrame: 0,
        isPlaying: false
      }
    }));
  }, [cancelPlaybackFrame, updateBoardSession]);

  const setVideoPreview = useCallback((next: VideoPreviewState | null) => {
    const id = activeBoardIdRef.current;
    const currentBoard = boardsRef.current.find((board) => board.id === id);
    if (!id || !currentBoard) {
      revokeVideoPreview(next);
      return;
    }

    cancelPlaybackFrame();
    revokeVideoPreview(currentBoard.videoPreview);
    updateBoardSession(id, (board) => ({
      ...board,
      videoPreview: next,
      timelineState: {
        ...board.timelineState,
        isPlaying: false
      }
    }));
  }, [cancelPlaybackFrame, updateBoardSession]);

  const clearVideoPreview = useCallback(() => {
    const id = activeBoardIdRef.current;
    const currentBoard = boardsRef.current.find((board) => board.id === id);
    if (!id || !currentBoard) return;

    cancelPlaybackFrame();
    revokeVideoPreview(currentBoard.videoPreview);
    updateBoardSession(id, (board) => ({
      ...board,
      videoPreview: null,
      timelineState: {
        ...board.timelineState,
        isPlaying: false
      }
    }));
  }, [cancelPlaybackFrame, updateBoardSession]);

  const toggleTimelinePlaying = useCallback(() => {
    updateTimelineState((current) => ({
      ...current,
      isPlaying: !current.isPlaying
    }));
  }, [updateTimelineState]);

  const stepTimelineFrame = useCallback((delta: number) => {
    updateTimelineState((current) => ({
      ...current,
      currentFrame: clampTimelineFrame(current.currentFrame + delta, current.totalFrames)
    }));
  }, [updateTimelineState]);

  const selectTimelineFrame = useCallback((frame: number) => {
    updateTimelineState((current) => ({
      ...current,
      currentFrame: clampTimelineFrame(frame, current.totalFrames)
    }));
  }, [updateTimelineState]);

  return {
    boards,
    activeBoardId,
    activeBoard,
    setActiveBoardId,
    generationParameters,
    updateGenerationParameters,
    timelineState,
    updateTimelineState,
    referenceImage,
    setReferenceImage,
    clearReferenceImage,
    colorReference,
    setColorReference,
    clearColorReference,
    videoPreview,
    setVideoPreview,
    clearVideoPreview,
    imageSequenceFrames,
    setImageSequenceFrames,
    clearImageSequenceFrames,
    createBoard,
    updateActiveBoardSession,
    removeBoard,
    toggleTimelinePlaying,
    stepTimelineFrame,
    selectTimelineFrame
  };
}
