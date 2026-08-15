import type { AISequenceBoardSession } from "../types/aiSequenceBoardSession";

type Props = {
  boards: AISequenceBoardSession[];
  activeBoardId: string | null;
  onSelectBoard: (id: string) => void;
  onCreateBoard: () => void;
  onRemoveBoard: (id: string) => void;
};

export function BoardSwitcher({
  boards,
  activeBoardId,
  onSelectBoard,
  onCreateBoard,
  onRemoveBoard
}: Props) {
  return (
    <nav className="board-switcher" data-source-board-switcher="1" aria-label="Source board sessions">
      {boards.map((board) => (
        <div
          key={board.id}
          className={board.id === activeBoardId ? "board-switcher__item board-switcher__item--active" : "board-switcher__item"}
          data-source-board-switcher-item="1"
          data-source-board-switcher-board-id={board.id}
          data-source-board-switcher-active={board.id === activeBoardId}
        >
          <button type="button" onClick={() => onSelectBoard(board.id)}>
            {board.name}
          </button>
          <button
            type="button"
            className="board-switcher__remove"
            aria-label={`Remove ${board.name}`}
            onClick={() => onRemoveBoard(board.id)}
          >
            x
          </button>
        </div>
      ))}
      <button
        type="button"
        className="board-switcher__add"
        data-source-board-switcher-add="1"
        onClick={onCreateBoard}
      >
        +
      </button>
    </nav>
  );
}
