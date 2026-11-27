import React, { useMemo, useState } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  Edit3,
  Flame,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  addDaysYmd,
  buildHabitHeatmap,
  collectHabitCompletedDays,
  computeHabitStreakStats,
} from '../../../core/habits/habitEngine';
import {
  HABIT_CATEGORIES,
  type CreateHabitInput,
  type HabitCategory,
  type HabitFrequency,
  type HabitItem,
} from '../../../core/habits/habitSchemas';
import { useHabits } from '../../../hooks/useHabits';
import { useUIStore } from '../../../state/useUIStore';
import { ModalPortal } from '../../../components/ModalPortal';

type HabitsTab = 'today' | 'heatmap';

const CATEGORY_LABELS: Record<HabitCategory, string> = {
  health: 'Health',
  mindfulness: 'Mindfulness',
  learning: 'Learning',
  finance: 'Finance',
  fitness: 'Fitness',
  productivity: 'Productivity',
  custom: 'Custom',
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const HabitsView: React.FC = () => {
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);

  const {
    habits,
    logs,
    loading,
    error,
    todayYmd,
    summary,
    createHabit,
    updateHabitMeta,
    toggleHabitDay,
    deleteHabit,
    restoreHabit,
  } = useHabits();

  const [tab, setTab] = useState<HabitsTab>('today');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [stripRange, setStripRange] = useState<7 | 14 | 30>(7);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitItem | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<HabitCategory>('health');
  const [frequency, setFrequency] = useState<HabitFrequency>('daily');
  const [targetPerWeek, setTargetPerWeek] = useState(5);
  const [reminderTime, setReminderTime] = useState('');
  const [saving, setSaving] = useState(false);

  const visibleHabits = useMemo(
    () => habits.filter((h) => (showArchived ? true : !h.archived)),
    [habits, showArchived]
  );

  const activeHabits = useMemo(() => habits.filter((h) => !h.archived), [habits]);

  const inspectedHabit = useMemo(() => {
    if (selectedHabitId) {
      const found = habits.find((h) => h.id === selectedHabitId);
      if (found) return found;
    }
    return activeHabits[0] ?? habits[0] ?? null;
  }, [selectedHabitId, habits, activeHabits]);

  const recentDays = useMemo(() => {
    const days: Array<{ ymd: string; label: string; dayNum: string }> = [];
    for (let i = stripRange - 1; i >= 0; i--) {
      const ymd = addDaysYmd(todayYmd, -i);
      const [y, m, d] = ymd.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      days.push({
        ymd,
        label: WEEKDAY_SHORT[dt.getUTCDay()],
        dayNum: String(d),
      });
    }
    return days;
  }, [todayYmd, stripRange]);

  const inspectedDays = useMemo(() => {
    if (!inspectedHabit) return new Set<string>();
    return collectHabitCompletedDays(inspectedHabit.id, logs);
  }, [inspectedHabit, logs]);

  const heatmapCells = useMemo(
    () => buildHabitHeatmap(inspectedDays, todayYmd, 84),
    [inspectedDays, todayYmd]
  );

  const bucketCountForInspected = useMemo(() => {
    if (!inspectedHabit) return 0;
    return logs.filter((b) => b.habitId === inspectedHabit.id && b.days.length > 0).length;
  }, [inspectedHabit, logs]);

  const openAddModal = () => {
    setEditingHabit(null);
    setName('');
    setCategory('health');
    setFrequency('daily');
    setTargetPerWeek(7);
    setReminderTime('');
    setModalOpen(true);
  };

  const openEditModal = (habit: HabitItem) => {
    setEditingHabit(habit);
    setName(habit.name);
    setCategory(habit.category);
    setFrequency(habit.frequency);
    setTargetPerWeek(habit.targetPerWeek);
    setReminderTime(habit.reminderTime ?? '');
    setModalOpen(true);
  };

  const handleSaveHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      if (editingHabit) {
        await updateHabitMeta(editingHabit, {
          name: trimmed,
          category,
          frequency,
          targetPerWeek: frequency === 'daily' ? 7 : Math.max(1, Math.min(7, targetPerWeek)),
          reminderTime: reminderTime.trim() || undefined,
        });
        showToast(`Updated "${trimmed}".`);
      } else {
        const payload: CreateHabitInput = {
          name: trimmed,
          category,
          frequency,
          targetPerWeek: frequency === 'daily' ? 7 : Math.max(1, Math.min(7, targetPerWeek)),
          reminderTime: reminderTime.trim() || undefined,
        };
        const created = await createHabit(payload);
        setSelectedHabitId(created.id);
        showToast(`Added habit "${created.name}".`);
      }
      setModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save habit.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDay = async (habit: HabitItem, ymd: string) => {
    try {
      const res = await toggleHabitDay(habit, ymd);
      showToast(
        res.added
          ? `Checked in "${habit.name}" (${ymd}) · ${res.currentStreak}d streak.`
          : `Unchecked "${habit.name}" (${ymd}).`,
        () => {
          void toggleHabitDay(habit, ymd);
        }
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update habit check-in.');
    }
  };

  const handleDeleteHabit = async (habit: HabitItem) => {
    try {
      await deleteHabit(habit);
      showToast(`Deleted habit "${habit.name}".`, () => {
        void restoreHabit(habit);
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete habit.');
    }
  };

  const handleToggleArchive = async (habit: HabitItem) => {
    try {
      await updateHabitMeta(habit, { archived: !habit.archived });
      showToast(habit.archived ? `Restored "${habit.name}".` : `Archived "${habit.name}".`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update habit status.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('habits.title')}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)] max-w-2xl">
            {t('habits.subtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="self-start sm:self-auto inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>{t('habits.addHabit')}</span>
        </button>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* Compact 1-Line Summary Bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-3 text-xs">
        <span>
          <span className="text-[var(--text-muted)]">{t('habits.kpiCompletedToday')}: </span>
          <strong className="font-numeric text-[var(--accent)]">
            {summary.completedTodayCount} / {summary.activeCount}
          </strong>
        </span>
        <span className="text-[var(--text-muted)]">·</span>
        <span>
          <span className="text-[var(--text-muted)]">{t('habits.kpiBestStreak')}: </span>
          <strong className="font-numeric text-orange-500">{summary.bestActiveStreak}d</strong>
        </span>
        <span className="text-[var(--text-muted)]">·</span>
        <span>
          <span className="text-[var(--text-muted)]">{t('habits.kpiConsistency30d')}: </span>
          <strong className="font-numeric text-[var(--text-primary)]">{summary.avgConsistency30dPct}%</strong>
        </span>
      </div>

      {/* Underline Segmented Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)]">
        <div className="flex items-center gap-4 sm:gap-6 overflow-x-auto no-scrollbar max-w-full">
          {(
            [
              { id: 'today', label: t('habits.tabToday'), icon: Flame },
              { id: 'heatmap', label: t('habits.tabHeatmap'), icon: CalendarDays },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {tab === 'today' && (
          <div className="flex items-center gap-3 pb-2.5">
            <div className="inline-flex items-center gap-1 rounded-xl bg-[var(--bg-subtle)] p-1 text-xs">
              {([7, 14, 30] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setStripRange(r)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    stripRange === r
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {r === 30 ? '30 Days' : `${r} Days`}
                </button>
              ))}
            </div>

            {habits.some((h) => h.archived) && (
              <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-emerald-600"
                />
                <span>{t('ui.showArchived')}</span>
              </label>
            )}
          </div>
        )}
      </div>

      {/* Empty State */}
      {!loading && habits.length === 0 ? (
        <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-6 py-12 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-subtle)] text-[var(--accent)]">
            <Flame className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
            {t('habits.emptyTitle')}
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--text-secondary)]">
            {t('habits.emptyDesc')}
          </p>
          <button
            type="button"
            onClick={openAddModal}
            className="mt-5 inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>{t('habits.addHabit')}</span>
          </button>
        </section>
      ) : tab === 'today' ? (
        /* Tab 1: Today & Streaks */
        <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
          {visibleHabits.map((habit) => {
            const completedDays = collectHabitCompletedDays(habit.id, logs);
            const stats = computeHabitStreakStats(habit, completedDays, todayYmd);
            return (
              <div
                key={habit.id}
                className={`p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                  habit.archived ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <button
                    type="button"
                    aria-label={
                      stats.completedToday
                        ? `Uncheck ${habit.name} for today`
                        : `Check in ${habit.name} for today`
                    }
                    onClick={() => void handleToggleDay(habit, todayYmd)}
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                      stats.completedToday
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                    }`}
                  >
                    <Check className="h-5 w-5" />
                  </button>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedHabitId(habit.id);
                          setTab('heatmap');
                        }}
                        className="text-sm sm:text-base font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors text-start"
                      >
                        {habit.name}
                      </button>
                      {habit.archived && (
                        <span className="text-xs text-[var(--text-muted)]">· Archived</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-muted)]">
                      <span>{CATEGORY_LABELS[habit.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {habit.frequency === 'daily'
                          ? t('habits.freqDaily')
                          : `${habit.targetPerWeek}x / week`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-numeric font-medium text-[var(--accent)]">
                        {stats.currentStreak}d streak
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-numeric">Best {stats.bestStreak}d</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-numeric">{stats.consistency30dPct}% (30d)</span>
                      {habit.reminderTime && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-numeric">{habit.reminderTime}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Interactive quick day strip + row actions */}
                <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 min-w-0">
                  <div
                    role="group"
                    aria-label={`Past days for ${habit.name}`}
                    className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1"
                  >
                    {recentDays.map((day) => {
                      const done = completedDays.has(day.ymd);
                      return (
                        <button
                          key={day.ymd}
                          type="button"
                          title={`${day.label} ${day.ymd}`}
                          aria-label={`Toggle ${habit.name} on ${day.ymd}`}
                          onClick={() => void handleToggleDay(habit, day.ymd)}
                          className={`flex flex-col items-center justify-center w-8 sm:w-9 h-10 rounded-lg border text-[10px] font-numeric shrink-0 transition-colors btn-spring ${
                            done
                              ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)] font-semibold'
                              : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)]/60'
                          }`}
                        >
                          <span>{day.label.slice(0, 2)}</span>
                          <span>{day.dayNum}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Edit ${habit.name}`}
                      onClick={() => openEditModal(habit)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={habit.archived ? `Unarchive ${habit.name}` : `Archive ${habit.name}`}
                      onClick={() => void handleToggleArchive(habit)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${habit.name}`}
                      onClick={() => void handleDeleteHabit(habit)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ) : tab === 'heatmap' && inspectedHabit ? (
        /* Tab 2: 84-Day Monthly-Bucketed Heatmap */
        <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                84-Day Consistency Heatmap
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Stored in compact monthly buckets ({bucketCountForInspected} active{' '}
                {bucketCountForInspected === 1 ? 'bucket' : 'buckets'}) · Click any day to toggle
              </p>
            </div>
            <select
              aria-label="Select habit for heatmap"
              value={inspectedHabit.id}
              onChange={(e) => setSelectedHabitId(e.target.value)}
              className="min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
            >
              {habits.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>

          {/* 12-week grid (12 columns x 7 rows) */}
          <div className="overflow-x-auto pb-2">
            <div className="grid grid-cols-12 gap-1.5 min-w-[480px]">
              {heatmapCells.map((cell) => (
                <button
                  key={cell.dateYmd}
                  type="button"
                  title={`${cell.dateYmd} · ${cell.completed ? 'Completed' : 'Missed'}`}
                  aria-label={`${cell.dateYmd} ${cell.completed ? 'completed' : 'not completed'}`}
                  onClick={() => void handleToggleDay(inspectedHabit, cell.dateYmd)}
                  className={`h-8 rounded-md border text-[10px] font-numeric transition-colors ${
                    cell.completed
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white font-semibold'
                      : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)]/60'
                  } ${cell.isToday ? 'ring-2 ring-emerald-500/40' : ''}`}
                >
                  {cell.dateYmd.slice(8)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border-hairline)] text-xs text-[var(--text-muted)]">
            <span className="font-numeric">
              Total completions logged: {inspectedDays.size}
            </span>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-xs border border-[var(--border-hairline)] bg-[var(--bg-canvas)]" />
                Not logged
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-xs bg-[var(--accent)]" />
                Completed
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {/* Add / Edit Habit Modal */}
      {modalOpen && (
        <ModalPortal onClose={() => setModalOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingHabit ? t('habits.editHabit') : t('habits.addHabit')}
            className="fixed inset-0 z-[60] flex items-stretch sm:items-center justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 p-0 sm:p-4 sm:backdrop-blur-xs overflow-y-auto anim-modal-backdrop"
            onClick={() => setModalOpen(false)}
          >
          <div
            className="w-full h-dvh sm:h-auto sm:max-w-lg rounded-none sm:rounded-2xl pt-safe pb-safe sm:pt-0 sm:pb-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl overflow-y-auto sm:max-h-[90dvh] anim-top-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {editingHabit ? t('habits.editHabit') : t('habits.addHabit')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveHabit} className="p-6 space-y-4">
              <div>
                <label
                  htmlFor="habit-name-input"
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                >
                  {t('habits.habitNameLabel')}
                </label>
                <input
                  id="habit-name-input"
                  type="text"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Morning Walk 20m, Read 15 pages"
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="habit-category-select"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                  >
                    {t('habits.categoryLabel')}
                  </label>
                  <select
                    id="habit-category-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as HabitCategory)}
                    className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    {HABIT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="habit-frequency-select"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                  >
                    {t('habits.frequencyLabel')}
                  </label>
                  <select
                    id="habit-frequency-select"
                    value={frequency}
                    onChange={(e) => {
                      const next = e.target.value as HabitFrequency;
                      setFrequency(next);
                      setTargetPerWeek(next === 'daily' ? 7 : 4);
                    }}
                    className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    <option value="daily">{t('habits.freqDaily')}</option>
                    <option value="weekly">{t('habits.freqWeekly')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {frequency === 'weekly' && (
                  <div>
                    <label
                      htmlFor="habit-target-week"
                      className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                    >
                      {t('habits.targetPerWeekLabel')}
                    </label>
                    <input
                      id="habit-target-week"
                      type="number"
                      min={1}
                      max={7}
                      value={targetPerWeek}
                      onChange={(e) => setTargetPerWeek(Number(e.target.value))}
                      className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 font-numeric text-sm text-[var(--text-primary)]"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="habit-reminder-time"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                  >
                    {t('habits.reminderTimeLabel')}
                  </label>
                  <input
                    id="habit-reminder-time"
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 font-numeric text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[42px] rounded-xl px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="min-h-[42px] rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {saving ? 'Saving...' : t('habits.saveHabit')}
                </button>
              </div>
            </form>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
};
