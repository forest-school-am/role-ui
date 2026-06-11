import React from 'react';
import { SECTION_LABEL_CLS } from '../../lib/ui-constants';
import EditButton from './EditButton';

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
          {onEdit && <EditButton onClick={onEdit} />}
        </div>
      )}
    </div>
    {children}
  </section>
);

export default Section;
