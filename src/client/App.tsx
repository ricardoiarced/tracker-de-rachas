import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  createHabit,
  downloadBackup,
  getSession,
  importBackup,
  loadExamples,
  removeHabit,
  resetDemo,
  setCompletion,
  startSession,
  updateHabit
} from "./api";
import { allCompletions, habitStats, overview, weekDates } from "./stats";
import { backupV1Schema, type BackupV1 } from "../shared/contracts";

function localDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

export function App() {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: getSession, retry: false });
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"bueno" | "malo">("bueno");
  const [weekOffset, setWeekOffset] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingLabel, setEditingLabel] = useState("");
  const [editingType, setEditingType] = useState<"bueno" | "malo">("bueno");
  const [selectedBackup, setSelectedBackup] = useState<BackupV1 | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const replaceSnapshot = (snapshot: NonNullable<typeof session.data>) =>
    queryClient.setQueryData(["session"], snapshot);
  const createSession = useMutation({
    mutationFn: () => startSession(localDate()),
    onSuccess: replaceSnapshot,
    retry: false
  });
  const habitMutation = useMutation({ mutationFn: createHabit, onSuccess: replaceSnapshot });
  const examplesMutation = useMutation({ mutationFn: loadExamples, onSuccess: replaceSnapshot });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name: string; label?: string; type: "bueno" | "malo" }) =>
      updateHabit(id, input),
    onSuccess: replaceSnapshot
  });
  const deleteMutation = useMutation({ mutationFn: removeHabit, onSuccess: replaceSnapshot });
  const completionMutation = useMutation({
    mutationFn: ({ habitId, date, completed }: { habitId: string; date: string; completed: boolean }) =>
      setCompletion(habitId, date, completed, localDate()),
    onSuccess: replaceSnapshot
  });
  const refreshSession = () => queryClient.invalidateQueries({ queryKey: ["session"] });
  const backupMutation = useMutation({ mutationFn: downloadBackup, retry: false });
  const importMutation = useMutation({
    mutationFn: ({ backup, revision }: { backup: BackupV1; revision: number }) =>
      importBackup(backup, revision),
    onSuccess: (nextSnapshot) => {
      setSelectedBackup(null);
      replaceSnapshot(nextSnapshot);
    },
    onError: refreshSession,
    retry: false
  });
  const resetMutation = useMutation({
    mutationFn: resetDemo,
    onSuccess: replaceSnapshot,
    onError: refreshSession,
    retry: false
  });
  const snapshot = session.data;

  function enterDemo() {
    createSession.mutate();
  }

  if (session.isPending || createSession.isPending) {
    return (
      <main className="screen">
        <p>
          {createSession.isPending ? "Preparando tu espacio aislado..." : "Comprobando la Sesión demo..."}
        </p>
      </main>
    );
  }

  if (session.isError || createSession.isError) {
    return (
      <main className="screen">
        <h1>No se pudo abrir la demo</h1>
        <p>No se creó ni modificó ninguna Sesión demo.</p>
        <button onClick={enterDemo}>Intentar de nuevo</button>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="screen">
        <p className="eyebrow">Registro de Hábitos</p>
        <h1>Prueba tu propia demo</h1>
        <p>
          No necesitas cuenta ni contraseña. Al entrar crearemos una Sesión demo aislada en este navegador.
        </p>
        <p>
          Usa solo datos de prueba: la sesión vence tras 24 horas sin actividad o, como máximo, en 7 días.
        </p>
        <button onClick={enterDemo}>Entrar a la demo</button>
      </main>
    );
  }

  const today = localDate();
  const dates = weekDates(today, weekOffset);
  const stats = overview(snapshot, today);
  const todayTotal = (stats.todayDone.bueno?.done ?? 0) + (stats.todayDone.malo?.done ?? 0);
  const actionError =
    habitMutation.error ||
    examplesMutation.error ||
    updateMutation.error ||
    deleteMutation.error ||
    completionMutation.error ||
    backupMutation.error ||
    importMutation.error ||
    resetMutation.error;
  const formatDate = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });

  function addHabit() {
    if (!name.trim()) return;
    habitMutation.mutate(
      { id: crypto.randomUUID(), name, ...(label.trim() ? { label } : {}), type },
      {
        onSuccess: () => {
          setName("");
          setLabel("");
        }
      }
    );
  }

  function saveBackup(backup: BackupV1) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "respaldo-rachas.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function selectBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) {
      setSelectedBackup(null);
      setBackupError("El Respaldo supera el límite de 512 KiB.");
      return;
    }

    try {
      setSelectedBackup(backupV1Schema.parse(JSON.parse(await file.text())));
      setBackupError(null);
    } catch {
      setSelectedBackup(null);
      setBackupError("El archivo no contiene un Respaldo v1 válido.");
    }
  }

  function confirmImport(revision: number) {
    if (!selectedBackup || !window.confirm("Se reemplazarán todos tus Hábitos y Cumplidos actuales.")) return;
    importMutation.mutate({ backup: selectedBackup, revision });
  }

  function confirmReset(revision: number) {
    if (!window.confirm("Se reemplazarán todos tus Hábitos y Cumplidos por los datos iniciales.")) return;
    resetMutation.mutate(revision);
  }

  return (
    <main className="app">
      <header>
        <p className="eyebrow">Registro de Hábitos</p>
        <h1>Tu semana, a la vista</h1>
        <p>Sesión demo activa hasta {new Date(snapshot.session.expiresAt).toLocaleString("es-MX")}.</p>
      </header>
      <section className="card" aria-label="Respaldo y reinicio">
        <h2>Respaldo y reinicio</h2>
        <p>Descarga tus datos o localiza un Respaldo v1 para reemplazarlos.</p>
        <div className="actions">
          <button
            className="ghost"
            onClick={() => backupMutation.mutate(undefined, { onSuccess: saveBackup })}
            disabled={backupMutation.isPending}
          >
            {backupMutation.isPending ? "Preparando Respaldo..." : "Descargar Respaldo"}
          </button>
          <button
            className="ghost"
            onClick={() => backupInput.current?.click()}
            disabled={importMutation.isPending}
          >
            Localizar Respaldo
          </button>
          <input
            ref={backupInput}
            aria-label="Archivo de Respaldo"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={selectBackup}
          />
          <button
            className="danger"
            onClick={() => confirmReset(snapshot.revision)}
            disabled={resetMutation.isPending}
          >
            {resetMutation.isPending ? "Reiniciando demo..." : "Reiniciar demo"}
          </button>
        </div>
        {selectedBackup && (
          <div className="actions">
            <span>Respaldo v1 listo: {selectedBackup.habits.length} Hábitos.</span>
            <button onClick={() => confirmImport(snapshot.revision)} disabled={importMutation.isPending}>
              {importMutation.isPending ? "Importando..." : "Importar y reemplazar"}
            </button>
          </div>
        )}
      </section>
      <section className="card add-card" aria-label="Nuevo Hábito">
        <h2>Nuevo Hábito</h2>
        <div className="form-row">
          <input
            aria-label="Nombre del Hábito"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addHabit()}
            placeholder="Ej. Leer 30 minutos"
          />
          <select
            aria-label="Tipo"
            value={type}
            onChange={(event) => setType(event.target.value as "bueno" | "malo")}
          >
            <option value="bueno">Bueno</option>
            <option value="malo">Malo</option>
          </select>
        </div>
        <div className="form-row">
          <input
            aria-label="Etiqueta"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={type === "bueno" ? "Este día sí..." : "Este día no..."}
          />
          <button onClick={addHabit} disabled={habitMutation.isPending}>
            Agregar Hábito
          </button>
          <button
            className="ghost"
            onClick={() => examplesMutation.mutate()}
            disabled={examplesMutation.isPending}
          >
            Cargar ejemplos
          </button>
        </div>
      </section>
      <section className="weekbar" aria-label="Navegación semanal">
        <button onClick={() => setWeekOffset((offset) => offset - 1)} aria-label="Semana anterior">
          ‹
        </button>
        <div>
          <strong>Semana del {formatDate(dates[0])}</strong>
          <span> al {formatDate(dates[6])}</span>
        </div>
        <button onClick={() => setWeekOffset((offset) => offset + 1)} aria-label="Semana siguiente">
          ›
        </button>
        <button className="ghost" onClick={() => setWeekOffset(0)}>
          Hoy
        </button>
      </section>
      <p className="today-summary">
        {snapshot.habits.length
          ? `Hoy cumpliste ${todayTotal} de ${snapshot.habits.length} Hábitos.`
          : "Agrega tu primer Hábito para comenzar."}
      </p>
      {actionError && (
        <p className="error" role="alert">
          No se pudo guardar el cambio. Se recargó el estado actual; inténtalo de nuevo.
        </p>
      )}
      {backupError && (
        <p className="error" role="alert">
          {backupError}
        </p>
      )}
      <section className="stats" aria-label="Estadísticas">
        <article>
          <b>{stats.current?.current ?? "—"}</b>
          <span>Racha más larga hoy</span>
          <small>{stats.current?.habit.name ?? "sin Hábitos"}</small>
        </article>
        <article>
          <b>{stats.record?.record ?? "—"}</b>
          <span>Mejor racha</span>
          <small>{stats.record?.habit.name ?? "sin Hábitos"}</small>
        </article>
        {(["bueno", "malo"] as const).map((entry) => (
          <article key={entry}>
            <b>{stats.perfect[entry] ?? "—"}</b>
            <span>Días perfectos {entry === "bueno" ? "buenos" : "malos"}</span>
            <small>esta semana</small>
          </article>
        ))}
        {(["bueno", "malo"] as const).map((entry) => (
          <article key={`today-${entry}`}>
            <b>
              {stats.todayDone[entry]
                ? `${stats.todayDone[entry].done}/${stats.todayDone[entry].total}`
                : "—"}
            </b>
            <span>Cumplido {entry === "bueno" ? "buenos" : "malos"} hoy</span>
            <small>Hábitos de tipo {entry}</small>
          </article>
        ))}
      </section>
      <section className="habits" aria-label="Hábitos">
        {snapshot.habits.map((habit) => {
          const completed = allCompletions(snapshot, habit.id);
          const habitStat = habitStats(habit, completed, today, dates);
          const percentage = habitStat.total ? Math.round((habitStat.done / habitStat.total) * 100) : 0;
          const editing = editingId === habit.id;
          return (
            <article className="card habit" key={habit.id}>
              {editing ? (
                <>
                  <div className="form-row">
                    <input
                      aria-label={`Nombre de ${habit.name}`}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                    />
                    <select
                      aria-label={`Tipo de ${habit.name}`}
                      value={editingType}
                      onChange={(event) => setEditingType(event.target.value as "bueno" | "malo")}
                    >
                      <option value="bueno">Bueno</option>
                      <option value="malo">Malo</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <input
                      aria-label={`Etiqueta de ${habit.name}`}
                      value={editingLabel}
                      onChange={(event) => setEditingLabel(event.target.value)}
                    />
                    <button
                      onClick={() =>
                        updateMutation.mutate(
                          { id: habit.id, name: editingName, label: editingLabel, type: editingType },
                          { onSuccess: () => setEditingId(null) }
                        )
                      }
                    >
                      Guardar
                    </button>
                    <button className="ghost" onClick={() => setEditingId(null)}>
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="habit-title">
                    <div>
                      <h2>{habit.name}</h2>
                      <p>{habit.label}</p>
                    </div>
                    <span className={`badge ${habit.type}`}>{habit.type}</span>
                    <div className="numbers">
                      <span>
                        Racha <b>{habitStat.current}</b>
                      </span>
                      <span>
                        Récord <b>{habitStat.record}</b>
                      </span>
                    </div>
                  </div>
                  <div className="progress">
                    <progress value={percentage} max="100" aria-label={`${habit.name} esta semana`} />
                    <b>{percentage}% esta semana</b>
                  </div>
                  <div className="days">
                    {dates.map((date) => {
                      const isDone = completed.has(date);
                      const future = date > today;
                      return (
                        <label className={future ? "future" : ""} key={date}>
                          <span>
                            {new Date(`${date}T12:00:00`)
                              .toLocaleDateString("es-MX", { weekday: "short" })
                              .slice(0, 1)}
                          </span>
                          <input
                            aria-label={`${habit.name} ${date}`}
                            type="checkbox"
                            checked={isDone}
                            onChange={() =>
                              completionMutation.mutate({ habitId: habit.id, date, completed: !isDone })
                            }
                          />
                          <i>{isDone ? "✓" : date < today ? "×" : ""}</i>
                        </label>
                      );
                    })}
                  </div>
                  <div className="actions">
                    <button
                      className="ghost"
                      onClick={() => {
                        setEditingId(habit.id);
                        setEditingName(habit.name);
                        setEditingLabel(habit.label);
                        setEditingType(habit.type);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (window.confirm(`¿Eliminar el Hábito \"${habit.name}\"? Se pierde su historial.`))
                          deleteMutation.mutate(habit.id);
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </>
              )}
            </article>
          );
        })}
        {!snapshot.habits.length && (
          <article className="card empty">
            <h2>Aún no tienes Hábitos</h2>
            <p>Agrega uno para comenzar.</p>
          </article>
        )}
      </section>
    </main>
  );
}
