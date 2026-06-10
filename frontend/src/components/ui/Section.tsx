import React from 'react';
import { SECTION_LABEL_CLS } from '../../lib/ui-constants';

interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  /** Render a pencil edit button. Pass undefined when already in edit mode. */
  onEdit?: () => void;
  /** Right-side action slot (e.g. "+ Add" buttons). */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({
  title,
  icon,
  onEdit,
  actions,
  className,
  children,
}) => (
  <section className={className}>
    <div className="flex items-center justify-between mb-1">
      <span className={`${SECTION_LABEL_CLS} flex items-center gap-1.5`}>
        {icon}
        {title}
      </span>
      {(actions || onEdit) && (
        <div className="flex items-center gap-2">
          {actions}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Edit
            </button>
          )}
        </div>
      )}
    </div>
    {children}
  </section>
);

export default Section;
