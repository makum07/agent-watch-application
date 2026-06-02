'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowRight } from 'lucide-react';

export function OpenById() {
  const router = useRouter();
  const [value, setValue] = useState('');

  const handleOpen = () => {
    const id = value.trim();
    if (!id) return;
    const uuid = id.split('/').pop()?.replace('.jsonl', '') || id;
    router.push(`/session/${uuid}`);
  };

  return (
    <div className="flex gap-2">
      <Input
        placeholder="Paste session ID or path..."
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleOpen()}
        className="bg-muted/50 border-border text-sm"
      />
      <Button onClick={handleOpen} disabled={!value.trim()} size="sm">
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
