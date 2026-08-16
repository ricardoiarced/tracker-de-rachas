import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("permite crear una Sesión demo y representa su snapshot", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "SESSION_MISSING" }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            revision: 0,
            session: { expiresAt: "2026-08-15T12:00:00.000Z" },
            habits: [{ id: "read", name: "Leer", label: "Este día sí leí", type: "bueno", position: 0 }],
            completions: [{ habitId: "read", date: "2026-08-14" }]
          }),
          { status: 201 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Entrar a la demo" }));

    expect(await screen.findByRole("heading", { name: "Tu semana, a la vista" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Leer" })).toBeInTheDocument();
    expect(screen.getByText("Mejor racha")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("muestra un Récord de todo el historial pasado y excluye Cumplidos futuros", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          revision: 0,
          session: { expiresAt: "2026-08-16T12:00:00.000Z" },
          habits: [{ id: "read", name: "Leer", label: "Este día sí leí", type: "bueno", position: 0 }],
          completions: [
            { habitId: "read", date: "2020-01-01" },
            { habitId: "read", date: "2020-01-02" },
            { habitId: "read", date: "2020-01-03" },
            { habitId: "read", date: "2099-01-01" },
            { habitId: "read", date: "2099-01-02" },
            { habitId: "read", date: "2099-01-03" },
            { habitId: "read", date: "2099-01-04" }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    const record = await screen.findByText("Mejor racha");
    expect(record.parentElement).toHaveTextContent("3");
  });

  it("permite navegar semanas y registrar un Cumplido desde la interfaz", async () => {
    const snapshot = {
      revision: 0,
      session: { expiresAt: "2026-08-16T12:00:00.000Z" },
      habits: [{ id: "read", name: "Leer", label: "Este día sí leí", type: "bueno", position: 0 }],
      completions: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    await screen.findByRole("heading", { name: "Leer" });
    const week = screen.getByLabelText("Navegación semanal").textContent;
    fireEvent.click(screen.getByRole("button", { name: "Semana siguiente" }));
    expect(screen.getByLabelText("Navegación semanal")).not.toHaveTextContent(week ?? "");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("permite confirmar un Reinicio de demo desde la interfaz", async () => {
    const snapshot = {
      revision: 0,
      session: { expiresAt: "2026-08-16T12:00:00.000Z" },
      habits: [{ id: "read", name: "Leer", label: "Este día sí leí", type: "bueno", position: 0 }],
      completions: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot, revision: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Reiniciar demo" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/reset");
  });
});
