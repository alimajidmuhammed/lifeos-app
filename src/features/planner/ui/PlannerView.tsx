import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  GripVertical,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_TASK_LISTS,
  getPriorityLabel,
  getTaskListMeta,
  type TaskItem,
  type TaskStatus,
} from '../../../core/planner/plannerSchemas';
import { formatLocalYmd } from '../../../core/planner/unifiedCalendar';
import { useDebts } from '../../../hooks/useDebts';
import { usePlanner } from '../../../hooks/usePlanner';
import { useReminders } from '../../../hooks/useReminders';
import { useUIStore } from '../../../state/useUIStore';
import { TaskFormModal } from './TaskFormModal';
import { UnifiedCalendarPanel } from './UnifiedCalendarPanel';
import { MoreActionsMenu } from '../../../components/MoreActionsMenu';

type PlannerTab = 'tasks' | 'calendar';
type StatusFilter = 'active' | 'todo' | 'in_progress' | 'done' | 'all';

export const PlannerView: React.FC = () => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const showToast = useUIStore((s) => s.showToast);

  const {
    tasks,
    loading,
    summary,
    isCloudSynced,
    createTask,
    reorderTaskBetween,
    setTaskStatus,
    toggleSubtask,
    updateTaskMeta,
    deleteTask,
    restoreTask,
  } = usePlanner();
  const { reminders } = useReminders();
  const { debts } = useDebts();

  const [tab, setTab] = useState<PlannerTab>('tasks');
  const [listFilter, setListFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formFocusAi, setFormFocusAi] = useState(false);
  const [formDefaultDate, setFormDefaultDate] = useState('');
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);

  const todayYmd = formatLocalYmd(new Date());

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (statusFilter === 'active' && task.status === 'done') return false;
      if (statusFilter === 'todo' && task.status !== 'todo') return false;
      if (statusFilter === 'in_progress' && task.status !== 'in_progress') return false;
      if (statusFilter === 'done' && task.status !== 'done') return false;
      if (listFilter !== 'all' && task.listId !== listFilter) return false;
      if (q) {
        const subs = (task.subtasks ?? []).map((s) => s.title).join(' ');
        const hay = `${task.title} ${task.notes ?? ''} ${task.listId} ${subs}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, listFilter, searchQuery]);

  const canReorder = searchQuery.trim() === '';

  const handleMoveByOffset = async (indexInFiltered: number, delta: -1 | 1) => {
    const targetIndex = indexInFiltered + delta;
    if (targetIndex < 0 || targetIndex >= filteredTasks.length) return;
    const moving = filteredTasks[indexInFiltered];
    const withoutMoving = filteredTasks.filter((t) => t.id !== moving.id);
    const prev = targetIndex > 0 ? withoutMoving[targetIndex - 1] : null;
    const next = targetIndex < withoutMoving.length ? withoutMoving[targetIndex] : null;
    await reorderTaskBetween(moving, prev, next);
  };

  const handleDropOnTask = async (targetTaskId: string) => {
    setDragOverTaskId(null);
    if (!draggedTaskId || draggedTaskId === targetTaskId) {
      setDraggedTaskId(null);
      return;
    }
    const moving = filteredTasks.find((t) => t.id === draggedTaskId);
    const targetIdx = filteredTasks.findIndex((t) => t.id === targetTaskId);
    const sourceIdx = filteredTasks.findIndex((t) => t.id === draggedTaskId);
    setDraggedTaskId(null);
    if (!moving || targetIdx === -1 || sourceIdx === -1) return;

    const withoutMoving = filteredTasks.filter((t) => t.id !== moving.id);
    const insertIdx = sourceIdx < targetIdx ? targetIdx : targetIdx;
    const prev = insertIdx > 0 ? withoutMoving[insertIdx - 1] : null;
    const next = insertIdx < withoutMoving.length ? withoutMoving[insertIdx] : null;
    await reorderTaskBetween(moving, prev, next);
  };

  const handleCycleStatus = async (task: TaskItem) => {
    const nextStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    await setTaskStatus(task, nextStatus);
    showToast(nextStatus === 'done' ? `Completed "${task.title}".` : `Reopened "${task.title}".`);
  };

  const handleDeleteWithUndo = async (task: TaskItem) => {
    await deleteTask(task);
    showToast(`Deleted "${task.title}".`, () => {
      void restoreTask(task);
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)]">
            <span>{isCloudSynced ? t('common.syncedCloudMode') : t('common.offlineLocalMode')}</span>
            <span aria-hidden="true"> · </span>
            <span>Single-write fractional-index ordering</span>
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('planner.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {t('planner.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <MoreActionsMenu
            items={[
              {
                id: 'ai_goal',
                label: t('planner.aiGoalBreakdown'),
                icon: Sparkles,
                tone: 'accent',
                onClick: () => {
                  setEditingTask(null);
                  setFormDefaultDate('');
                  setFormFocusAi(true);
                  setFormOpen(true);
                },
              },
            ]}
          />

          <button
            type="button"
            onClick={() => {
              setEditingTask(null);
              setFormDefaultDate('');
              setFormFocusAi(false);
              setFormOpen(true);
            }}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>{t('planner.addTask')}</span>
          </button>
        </div>
      </section>

      {/* Compact 1-Line Planner Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span>
            <span className="text-[var(--text-muted)]">{t('planner.kpiDueToday')}: </span>
            <strong className="font-numeric text-[var(--accent)]">{summary.dueTodayCount}</strong>
          </span>
          <span className="text-[var(--text-muted)]">·</span>
          <span>
            <span className="text-[var(--text-muted)]">{t('planner.kpiActive')}: </span>
            <strong className="font-numeric text-[var(--text-primary)]">{summary.activeCount}</strong>
          </span>
          <span className="text-[var(--text-muted)]">·</span>
          <span>
            <span className="text-[var(--text-muted)]">{t('planner.kpiCompleted')}: </span>
            <strong className="font-numeric text-emerald-600 dark:text-emerald-400">
              {summary.completedCount}/{summary.totalCount}
            </strong>
          </span>
        </div>
        <span className="font-numeric text-[var(--text-muted)]">
          {summary.totalCount > 0 ? Math.round((summary.completedCount / summary.totalCount) * 100) : 0}% done
        </span>
      </div>

      {/* View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Planner views"
          className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tasks'}
            onClick={() => setTab('tasks')}
            className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'tasks'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t('planner.tabTasks')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'calendar'}
            onClick={() => setTab('calendar')}
            className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'calendar'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t('planner.tabCalendar')}
          </button>
        </div>
      </div>

      {tab === 'calendar' ? (
        <UnifiedCalendarPanel
          tasks={tasks}
          reminders={reminders}
          debts={debts}
          locale={profile.locale}
          onAddTaskForDate={(ymd) => {
            setEditingTask(null);
            setFormDefaultDate(ymd);
            setFormFocusAi(false);
            setFormOpen(true);
          }}
        />
      ) : (
        <div className="space-y-4">
          {/* Search, List & Status Filters */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('planner.searchPlaceholder')}
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] ps-10 pe-3.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <select
                aria-label="Filter by list"
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                className="min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="all">{t('planner.allLists')}</option>
                {DEFAULT_TASK_LISTS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {t(l.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]">
              {(
                [
                  { id: 'active', label: 'Active' },
                  { id: 'todo', label: t('planner.statusTodo') },
                  { id: 'in_progress', label: t('planner.statusInProgress') },
                  { id: 'done', label: t('planner.statusDone') },
                  { id: 'all', label: 'All' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStatusFilter(item.id)}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    statusFilter === item.id
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Task List */}
          {loading ? (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
              {[0, 1, 2].map((i) => (
                <div key={i} className="p-5 flex items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-52 rounded bg-[var(--bg-subtle)] animate-pulse" />
                    <div className="h-3 w-72 rounded bg-[var(--bg-subtle)] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-10 text-center space-y-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {tasks.length === 0 ? t('planner.emptyTitle') : 'No tasks match your filters'}
              </h2>
              <p className="max-w-md mx-auto text-xs sm:text-sm text-[var(--text-secondary)]">
                {tasks.length === 0
                  ? t('planner.emptyDesc')
                  : 'Clear the search box or switch status to All.'}
              </p>
              {tasks.length === 0 && (
                <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTask(null);
                      setFormDefaultDate('');
                      setFormFocusAi(false);
                      setFormOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{t('planner.addTask')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTask(null);
                      setFormDefaultDate('');
                      setFormFocusAi(true);
                      setFormOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                  >
                    <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                    <span>{t('planner.aiGoalBreakdown')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
              {filteredTasks.map((task, idx) => {
                const prio = getPriorityLabel(task.priority);
                const listMeta = getTaskListMeta(task.listId);
                const subs = task.subtasks ?? [];
                const doneSubs = subs.filter((s) => s.done).length;
                const isExpanded = Boolean(expandedIds[task.id]);
                const isOverdue = Boolean(task.dueDate && task.dueDate < todayYmd && task.status !== 'done');
                const isDragTarget = dragOverTaskId === task.id && draggedTaskId !== task.id;

                return (
                  <div
                    key={task.id}
                    draggable={canReorder}
                    onDragStart={() => setDraggedTaskId(task.id)}
                    onDragOver={(e) => {
                      if (!canReorder) return;
                      e.preventDefault();
                      setDragOverTaskId(task.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverTaskId === task.id) setDragOverTaskId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      void handleDropOnTask(task.id);
                    }}
                    onDragEnd={() => {
                      setDraggedTaskId(null);
                      setDragOverTaskId(null);
                    }}
                    className={`px-5 py-4 transition-colors ${
                      isDragTarget ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-subtle)]/40'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {canReorder && (
                          <span
                            aria-hidden="true"
                            title="Drag to reorder"
                            className="mt-1 hidden sm:inline-flex text-[var(--text-muted)] cursor-grab active:cursor-grabbing shrink-0"
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>
                        )}

                        <button
                          type="button"
                          aria-label={task.status === 'done' ? 'Reopen task' : 'Complete task'}
                          onClick={() => void handleCycleStatus(task)}
                          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                            task.status === 'done'
                              ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                              : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-transparent hover:border-[var(--accent)]'
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span
                              className={`text-sm font-semibold ${
                                task.status === 'done'
                                  ? 'line-through text-[var(--text-muted)]'
                                  : 'text-[var(--text-primary)]'
                              }`}
                            >
                              {task.title}
                            </span>
                            <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                            <span className="text-xs font-medium text-[var(--accent)]">
                              {t(listMeta.labelKey)}
                            </span>
                            <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                            <span
                              className={`font-numeric text-xs font-medium ${
                                task.priority === 1
                                  ? 'text-red-600 dark:text-red-400'
                                  : task.priority === 2
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-[var(--text-muted)]'
                              }`}
                            >
                              {prio.short}
                            </span>
                            {task.status === 'in_progress' && (
                              <>
                                <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                                <span className="text-xs font-medium text-[var(--accent)]">
                                  {t('planner.statusInProgress')}
                                </span>
                              </>
                            )}
                            {isOverdue && (
                              <>
                                <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                                <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                                  Overdue
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--text-muted)]">
                            {task.dueDate && (
                              <span className="font-numeric">Due {task.dueDate}</span>
                            )}
                            {subs.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedIds((prev) => ({ ...prev, [task.id]: !prev[task.id] }))
                                }
                                className="inline-flex items-center gap-1 font-numeric text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                                <span>
                                  {doneSubs}/{subs.length} subtasks
                                </span>
                              </button>
                            )}
                            <span className="font-numeric text-[11px] opacity-70">
                              key:{task.sortKey}
                            </span>
                            {task.notes && (
                              <span className="truncate max-w-xs">· {task.notes}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Row Action Controls */}
                      <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                        {task.status !== 'done' && (
                          <button
                            type="button"
                            onClick={() =>
                              void setTaskStatus(
                                task,
                                task.status === 'in_progress' ? 'todo' : 'in_progress'
                              )
                            }
                            className="min-h-[36px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                          >
                            {task.status === 'in_progress' ? 'Pause' : 'Start'}
                          </button>
                        )}

                        {canReorder && filteredTasks.length > 1 && (
                          <>
                            <button
                              type="button"
                              aria-label="Move task up"
                              disabled={idx === 0}
                              onClick={() => void handleMoveByOffset(idx, -1)}
                              className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Move task down"
                              disabled={idx === filteredTasks.length - 1}
                              onClick={() => void handleMoveByOffset(idx, 1)}
                              className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          aria-label={t('planner.editTask')}
                          onClick={() => {
                            setEditingTask(task);
                            setFormFocusAi(false);
                            setFormOpen(true);
                          }}
                          className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          aria-label="Delete task"
                          onClick={() => void handleDeleteWithUndo(task)}
                          className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Subtasks Checklist */}
                    {isExpanded && subs.length > 0 && (
                      <div className="mt-3 ps-9 sm:ps-16 space-y-1.5">
                        {subs.map((st) => (
                          <label
                            key={st.id}
                            className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)] cursor-pointer py-1"
                          >
                            <input
                              type="checkbox"
                              checked={st.done}
                              onChange={() => void toggleSubtask(task, st.id)}
                              className="h-4 w-4 accent-[var(--accent)] rounded"
                            />
                            <span className={st.done ? 'line-through text-[var(--text-muted)]' : ''}>
                              {st.title}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <TaskFormModal
        open={formOpen}
        editingTask={editingTask}
        defaultListId={listFilter === 'all' ? 'inbox' : listFilter}
        defaultDueDate={formDefaultDate}
        initialFocusAi={formFocusAi}
        onClose={() => {
          setFormOpen(false);
          setEditingTask(null);
        }}
        onCreate={async (input) => {
          await createTask(input);
          showToast(`Added task "${input.title}".`);
        }}
        onUpdate={async (current, patch) => {
          await updateTaskMeta(current, patch);
          showToast(`Updated "${patch.title ?? current.title}".`);
        }}
      />
    </div>
  );
};
