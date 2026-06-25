'use client';

interface LocalDateProps {
  iso: string;
}

export function LocalDate({ iso }: LocalDateProps) {
  return (
    <>
      {new Date(iso).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </>
  );
}
