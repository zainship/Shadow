import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Brain, Plus, Search, Star, Trash2 } from 'lucide-react';
import type {
  AssistantMemory,
  MemoryCategory,
  MemoryImportance,
} from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_FIELD,
  MAC_GLASS_INPUT_WRAP,
  MAC_GLASS_TOOLBAR,
  MacSegmentedControl,
} from './MacWindowShell';

interface MemoryStageViewProps {
  assistantName: string;
  memories: AssistantMemory[];
  onAddMemory: (input: {
    category: MemoryCategory;
    content: string;
    importance: MemoryImportance;
  }) => Promise<void>;
  onToggleImportance: (memory: AssistantMemory) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
}

const CATEGORIES: ReadonlyArray<{ id: 'all' | MemoryCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'preference', label: 'Preference' },
  { id: 'fact', label: 'Fact' },
  { id: 'project', label: 'Project' },
  { id: 'routine', label: 'Routine' },
  { id: 'person', label: 'Person' },
];

export const MemoryStageView: React.FC<MemoryStageViewProps> = ({
  assistantName,
  memories,
  onAddMemory,
  onToggleImportance,
  onDeleteMemory,
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | MemoryCategory>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [content, setContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('fact');
  const [newImportance, setNewImportance] = useState<MemoryImportance>('normal');
  const prefersReduced = useReducedMotion();

  const filtered = useMemo(() => {
    return memories.filter((m) => {
      if (category !== 'all' && m.category !== category) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return m.content.toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
    });
  }, [memories, search, category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = content.trim();
    if (!clean) return;
    await onAddMemory({
      category: newCategory,
      content: clean.slice(0, 600),
      importance: newImportance,
    });
    setContent('');
    setShowAdd(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={`${MAC_GLASS_TOOLBAR} justify-between`}>
        <div className="flex items-center gap-2.5 flex-1 min-w-[220px]">
          <div className={`${MAC_GLASS_INPUT_WRAP} w-full max-w-xs`}>
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search what ${assistantName} remembers...`}
              className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <MacSegmentedControl
            layoutId="mac-memory-cat"
            value={category}
            onChange={setCategory}
            options={CATEGORIES}
            className="hidden lg:inline-flex"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className={MAC_GLASS_BTN_PRIMARY}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Memory</span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showAdd && (
          <motion.form
            initial={prefersReduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            onSubmit={(e) => void handleSubmit(e)}
            className="overflow-hidden border-b border-white/10 bg-white/[0.025]"
          >
            <div className="px-5 py-4 flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[240px] space-y-1 text-xs text-slate-300">
                <span>Fact, Preference, Project, or Routine</span>
                <input
                  type="text"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={`Tell ${assistantName} something to remember permanently...`}
                  maxLength={600}
                  required
                  className={MAC_GLASS_FIELD}
                />
              </label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                className="px-2.5 py-1.5 rounded-[10px] bg-black/40 border border-white/12 text-xs text-slate-100 focus:outline-none focus:border-sky-400/60"
              >
                <option value="preference">Preference</option>
                <option value="fact">Fact</option>
                <option value="project">Project</option>
                <option value="routine">Routine</option>
                <option value="person">Person</option>
              </select>
              <select
                value={newImportance}
                onChange={(e) => setNewImportance(e.target.value as MemoryImportance)}
                className="px-2.5 py-1.5 rounded-[10px] bg-black/40 border border-white/12 text-xs text-slate-100 focus:outline-none focus:border-sky-400/60"
              >
                <option value="normal">Normal</option>
                <option value="high">High Priority</option>
                <option value="low">Low</option>
              </select>
              <button type="submit" className={MAC_GLASS_BTN_PRIMARY}>
                Save Memory
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-2">
            <Brain className="w-7 h-7 text-amber-300/70 mx-auto" />
            <p className="text-sm text-slate-200">
              {memories.length === 0
                ? `${assistantName} hasn’t stored any long-term memories yet.`
                : 'No memories match your current filter.'}
            </p>
            <p className="text-xs text-slate-400">
              Say “Remember that I prefer Rust and VS Code” or add a fact above.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/8">
            {filtered.map((mem) => (
              <div
                key={mem.id}
                className="px-5 py-3.5 hover:bg-white/[0.035] transition-colors flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="capitalize text-sky-300 font-medium">{mem.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{mem.source}</span>
                    {mem.importance === 'high' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-300 font-medium">Priority</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-100 leading-relaxed break-words">
                    {mem.content}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void onToggleImportance(mem)}
                    title={mem.importance === 'high' ? 'Unpin priority' : 'Mark high priority'}
                    className={`p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors cursor-pointer ${
                      mem.importance === 'high'
                        ? 'text-amber-400'
                        : 'text-slate-500 hover:text-amber-300'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteMemory(mem.id)}
                    aria-label="Delete memory"
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/[0.08] transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
