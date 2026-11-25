import React, { useEffect, useState } from 'react';
import { Plus, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { requestGoalBreakdown } from '../../../core/ai/plannerAiClient';
import { evaluateDailyAiQuota, getTodayDayKey } from '../../../core/entitlements/entitlements';
import {
  DEFAULT_TASK_LISTS,
  type CreateTaskInput,
  type SubtaskItem,
  type TaskItem,
  type TaskStatus,
} from '../../../core/planner/plannerSchemas';
import { aiUsageRepository } from '../../../data/repositories/firebaseWebAdapter';
import { useUIStore } from '../../../state/useUIStore';

interface TaskFormModalProps {
  open: boolean;
  editingTask: TaskItem | null;
  defaultListId?: string;
  defaultDueDate?: string;
  initialFocusAi?: boolean;
  onClose: () => void;
  onCreate: (input: CreateTaskInput) => Promise<void>;
  onUpdate: (
    current: TaskItem,
    patch: Partial<
      Pick<
        TaskItem,
        'listId' | 'title' | 'notes' | 'priority' | 'dueDate' | 'subtasks' | 'tags' | 'status'
      >
    >
  ) => Promise<void>;
}

function makeSubtaskId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const TaskFormModal: React.FC<TaskFormModalProps> = ({
  open,
  editingTask,
  defaultListId = 'inbox',
  defaultDueDate = '',
  initialFocusAi = false,
  onClose,
  onCreate,
  onUpdate,
}) => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const authUser = useUIStore((s) => s.authUser);
  const entitlements = useUIStore((s) => s.entitlements);
  const todayAiUsage = useUIStore((s) => s.todayAiUsage);
  const incrementLocalAiUsage = useUIStore((s) => s.incrementLocalAiUsage);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [listId, setListId] = useState(defaultListId);
  const [priority, setPriority] = useState<number>(3);
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [subtasks, setSubtasks] = useState<SubtaskItem[]>([]);
  const [newSubtaskText, setNewSubtaskText] = useState('');

  // AI Goal Breakdown state
  const [aiGoal, setAiGoal] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setAiError(null);
    setAiNotice(null);
    setAiGoal('');
    setNewSubtaskText('');

    if (editingTask) {
      setTitle(editingTask.title);
      setNotes(editingTask.notes ?? '');
      setListId(editingTask.listId);
      setPriority(editingTask.priority);
      setStatus(editingTask.status);
      setDueDate(editingTask.dueDate ?? '');
      setSubtasks(editingTask.subtasks ? [...editingTask.subtasks] : []);
    } else {
      setTitle('');
      setNotes('');
      setListId(defaultListId || 'inbox');
      setPriority(3);
      setStatus('todo');
      setDueDate(defaultDueDate || '');
      setSubtasks([]);
    }
  }, [open, editingTask, defaultListId, defaultDueDate]);

  if (!open) return null;

  const isEditing = Boolean(editingTask);
  const aiAllowed = profile.aiGlobalEnabled && (profile.aiModuleToggles?.planner ?? true);

  const addSubtask = () => {
    const clean = newSubtaskText.trim();
    if (!clean || subtasks.length >= 20) return;
    setSubtasks((prev) => [...prev, { id: makeSubtaskId(), title: clean, done: false }]);
    setNewSubtaskText('');
  };

  const removeSubtask = (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  };

  const handleAiBreakdown = async () => {
    const cleanGoal = aiGoal.trim();
    if (!cleanGoal) return;
    if (!aiAllowed) {
      setAiError(t('assistant.disabledNotice'));
      return;
    }

    const dayKey = getTodayDayKey();
    const usedToday = todayAiUsage.dayKey === dayKey ? todayAiUsage.requestCount : 0;
    const quota = evaluateDailyAiQuota(usedToday, entitlements);
    if (!quota.allowed) {
      setAiError(`Daily AI quota reached (${quota.usedToday}/${quota.dailyLimit}). Add subtasks manually below.`);
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setAiNotice(null);

    const res = await requestGoalBreakdown({
      goal: cleanGoal,
      locale: profile.locale,
      todayYmd: dayKey,
      freeTier: entitlements.plan === 'free',
    });

    setAiLoading(false);

    if (!res.ok) {
      setAiError(res.error);
      return;
    }

    const draft = res.data;
    setTitle(draft.title);
    setListId(draft.listId);
    setPriority(draft.priority);
    if (draft.dueDate) setDueDate(draft.dueDate);
    if (draft.notes) setNotes(draft.notes);
    setSubtasks(
      draft.subtasks.slice(0, 20).map((st) => ({
        id: makeSubtaskId(),
        title: st,
        done: false,
      }))
    );
    setAiNotice(t('planner.aiBreakdownNotice'));

    incrementLocalAiUsage(dayKey, res.meta.inputTokensEst, res.meta.outputTokensEst);
    if (authUser) {
      void aiUsageRepository.recordUsage(
        authUser.uid,
        dayKey,
        todayAiUsage.dayKey === dayKey ? todayAiUsage : null,
        res.meta.inputTokensEst,
        res.meta.outputTokensEst
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('Task title is required.');
      return;
    }

    setSaving(true);
    try {
      if (isEditing && editingTask) {
        await onUpdate(editingTask, {
          title: cleanTitle,
          notes: notes.trim() || undefined,
          listId,
          priority,
          status,
          dueDate: dueDate || undefined,
          subtasks,
        });
      } else {
        await onCreate({
          title: cleanTitle,
          notes: notes.trim() || undefined,
          listId,
          priority,
          status,
          dueDate: dueDate || undefined,
          subtasks: subtasks.length > 0 ? subtasks : undefined,
        });
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? t('planner.editTask') : t('planner.addTask')}
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 sm:backdrop-blur-xs p-0 sm:p-4 overflow-y-auto anim-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full h-dvh sm:h-auto sm:max-w-xl rounded-none sm:rounded-2xl pt-safe pb-safe sm:pt-0 sm:pb-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl overflow-hidden sm:my-auto sm:max-h-[90dvh] flex flex-col anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-hairline)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {isEditing ? t('planner.editTask') : t('planner.addTask')}
          </h2>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {!isEditing && (
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>{t('planner.aiGoalBreakdown')}</span>
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">Preview before saving</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  autoFocus={initialFocusAi}
                  value={aiGoal}
                  onChange={(e) => setAiGoal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAiBreakdown();
                    }
                  }}
                  placeholder={t('planner.aiGoalPlaceholder')}
                  className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  disabled={aiLoading || !aiGoal.trim()}
                  onClick={() => void handleAiBreakdown()}
                  className="min-h-[40px] rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {aiLoading ? '...' : t('planner.aiBreakdownBtn')}
                </button>
              </div>
              {aiNotice && <p className="text-xs text-[var(--accent)] font-medium">{aiNotice}</p>}
              {aiError && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{aiError}</span>
                </p>
              )}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t('planner.taskTitleLabel')}
              </label>
              <input
                type="text"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Prepare passport renewal documents"
                className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('planner.listLabel')}
                </label>
                <select
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {DEFAULT_TASK_LISTS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {t(l.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('planner.priorityLabel')}
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value={1}>P1 · Urgent</option>
                  <option value={2}>P2 · High</option>
                  <option value={3}>P3 · Medium</option>
                  <option value={4}>P4 · Low</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('planner.dueDateLabel')}
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            {isEditing && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="todo">{t('planner.statusTodo')}</option>
                  <option value="in_progress">{t('planner.statusInProgress')}</option>
                  <option value="done">{t('planner.statusDone')}</option>
                </select>
              </div>
            )}

            {/* Subtasks Builder (capped at 20 per Pillar 5) */}
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {t('planner.subtasksLabel')}
                </span>
                <span className="font-numeric text-[11px] text-[var(--text-muted)]">
                  {subtasks.length} / 20
                </span>
              </div>

              {subtasks.length > 0 && (
                <div className="space-y-1.5">
                  {subtasks.map((st, idx) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2"
                    >
                      <span className="text-xs text-[var(--text-primary)] min-w-0 flex-1 truncate">
                        <span className="font-numeric text-[var(--text-muted)] me-1.5">{idx + 1}.</span>
                        {st.title}
                      </span>
                      <button
                        type="button"
                        aria-label="Remove subtask"
                        onClick={() => removeSubtask(st.id)}
                        className="text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={200}
                  value={newSubtaskText}
                  onChange={(e) => setNewSubtaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSubtask();
                    }
                  }}
                  placeholder={t('planner.addSubtaskPlaceholder')}
                  className="flex-1 min-w-0 min-h-[38px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  disabled={!newSubtaskText.trim() || subtasks.length >= 20}
                  onClick={addSubtask}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-50 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Notes
              </label>
              <textarea
                rows={2}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional context, checklist notes, or links..."
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {formError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">{formError}</p>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--border-hairline)]">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] rounded-xl border border-[var(--border-hairline)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[42px] rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {saving ? '...' : isEditing ? t('planner.saveChanges') : t('planner.saveTask')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
