'use client';

interface SectionTabsProps {
  sections: { number: number; name: string; count: number }[];
  activeSection: number | null;
  onSelect: (sectionNumber: number | null) => void;
}

export default function SectionTabs({ sections, activeSection, onSelect }: SectionTabsProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-2 border-b border-gray-200">
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-2 text-sm font-medium rounded-t whitespace-nowrap ${
          activeSection === null ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        All
      </button>
      {sections.map((s) => (
        <button
          key={s.number}
          onClick={() => onSelect(s.number)}
          className={`px-3 py-2 text-sm font-medium rounded-t whitespace-nowrap ${
            activeSection === s.number ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {s.name} <span className="ml-1 text-xs opacity-75">({s.count})</span>
        </button>
      ))}
    </div>
  );
}
