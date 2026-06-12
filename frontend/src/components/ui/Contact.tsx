import React, { useState } from 'react';
import CopyIcon from './CopyIcon';

interface ContactProps {
  value: string;
  /** If provided, an envelope button opens this URL in a new tab. */
  href?: string;
}

const Contact: React.FC<ContactProps> = ({ value, href }) => {
  const [flash, setFlash] = useState(false);

  const handleValueClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(value).then(() => {
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    });
  };

  return (
    <span className="flex items-center gap-1.5">
      <span
        onClick={handleValueClick}
        title="Click to copy"
        className="cursor-pointer select-none transition-colors hover:text-indigo-600"
      >
        {flash ? <span className="text-green-500 text-xs font-medium">copied</span> : value}
      </span>
      <CopyIcon text={value} />
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Write to"
          className="flex-none text-gray-300 hover:text-gray-500 transition-colors"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M2 7l10 7 10-7" />
          </svg>
        </a>
      )}
    </span>
  );
};

export default Contact;
