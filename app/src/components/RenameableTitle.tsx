import { useState } from 'react';
import { EditIcon } from './icons';

type RenameableTitleProps = {
  name: string;
  onRename: (name: string) => void;
  titleClassName: string;
  renameLabel: string;
};

export const RenameableTitle = ({ name, onRename, titleClassName, renameLabel }: RenameableTitleProps) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed === '' || trimmed === name) {
      setDraft(name);
      return;
    }
    onRename(trimmed);
  };

  if (editing) {
    return (
      <input
        aria-label="List name"
        className={titleClassName}
        value={draft}
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        enterKeyHint="done"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            commit();
          } else if (event.key === 'Escape') {
            setDraft(name);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <>
      <div className={titleClassName}>{name}</div>
      <button
        type="button"
        className="iconbtn"
        aria-label={renameLabel}
        onClick={(event) => {
          event.stopPropagation();
          setDraft(name);
          setEditing(true);
        }}
      >
        <EditIcon />
      </button>
    </>
  );
};
