type Props = {
  variant: "empty" | "compact";
  onAddBoard: () => void;
};

export function AddBoardButton({ variant, onAddBoard }: Props) {
  return (
    <button
      type="button"
      className={`add-board-button add-board-button--${variant}`}
      data-source-add-board-button="1"
      onClick={onAddBoard}
    >
      + 添加画板
    </button>
  );
}
