import type { LayoutNode } from '@/types/workspace';

export function getFirstPaneId(node: LayoutNode): string | null {
  if (node.type === 'pane') return node.id;
  return getFirstPaneId(node.children[0]);
}

export function findOtherPane(node: LayoutNode, excludeId: string): string | null {
  if (node.type === 'pane') return node.id !== excludeId ? node.id : null;
  return findOtherPane(node.children[0], excludeId) ?? findOtherPane(node.children[1], excludeId);
}
