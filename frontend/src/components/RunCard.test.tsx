import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../api";
import { mockApi } from "../test-utils";
import { RunCard } from "./RunCard";

const base: Omit<Job, "id" | "title" | "status" | "label"> = {
  kind: "run",
  message: null,
  progress: null,
  started_at: "2026-10-30T15:14:27Z",
  finished_at: null,
  link: "/activity/queue/6",
  run_id: 6,
  cancellable: true,
};

function renderCard(onOpen = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RunCard onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { onOpen, ...view };
}

beforeEach(() => {
  vi.setSystemTime(new Date("2026-10-30T15:16:27Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RunCard", () => {
  it("shows a running Kometa run with message, elapsed time, queued count and an indeterminate bar", async () => {
    const running: Job = {
      ...base,
      id: "run-6",
      title: "Building 5 ready-made",
      status: "running",
      label: "Running",
      message: "Collection list for Movies",
      progress: null,
    };
    const queued: Job = { ...base, id: "run-7", title: "Kometa: Overlays", status: "pending", label: "Queued", run_id: 7, link: "/activity/queue/7" };
    mockApi({ "GET /jobs": () => ({ jobs: [running, queued], at: "2026-10-30T15:16:27Z" }) });
    renderCard();

    const card = await screen.findByRole("button", { name: /Running: Building 5 ready-made/i });
    expect(screen.getByText("Building 5 ready-made")).toBeInTheDocument();
    expect(screen.getByText("Collection list for Movies")).toBeInTheDocument();
    expect(screen.getByText("2 min")).toBeInTheDocument();
    expect(screen.getByText("+1 queued")).toBeInTheDocument();
    const bar = withinCardProgress(card);
    expect(bar).toHaveAttribute("role", "progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
  });

  it("shows a determinate bar when the job has progress", async () => {
    const running: Job = {
      ...base,
      id: "task-counts",
      kind: "task",
      title: "Ready-made counts",
      status: "running",
      label: "Running",
      progress: { value: 5, max: 10 },
      run_id: null,
      link: "/system/tasks",
      cancellable: false,
    };
    mockApi({ "GET /jobs": () => ({ jobs: [running], at: "2026-10-30T15:16:27Z" }) });
    renderCard();

    const card = await screen.findByRole("button", { name: /Running: Ready-made counts/i });
    const bar = withinCardProgress(card);
    expect(bar).toHaveAttribute("aria-valuenow", "5");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
  });

  it("shows waiting to start when only pending jobs exist", async () => {
    const queued: Job = { ...base, id: "run-7", title: "Kometa: Collections", status: "pending", label: "Queued", started_at: null };
    mockApi({ "GET /jobs": () => ({ jobs: [queued], at: "2026-10-30T15:16:27Z" }) });
    renderCard();

    await screen.findByRole("button", { name: /Waiting: Kometa: Collections/i });
    expect(screen.getByText("Waiting to start")).toBeInTheDocument();
    expect(screen.getByText("Kometa: Collections")).toBeInTheDocument();
    expect(screen.queryByText(/queued/)).toBeNull();
  });

  it("renders nothing when no job is running or pending", async () => {
    mockApi({ "GET /jobs": () => ({ jobs: [], at: "2026-10-30T15:16:27Z" }) });
    const { container } = renderCard();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("calls onOpen when the card is clicked", async () => {
    const running: Job = { ...base, id: "run-6", title: "Kometa run", status: "running", label: "Running" };
    mockApi({ "GET /jobs": () => ({ jobs: [running], at: "2026-10-30T15:16:27Z" }) });
    const onOpen = vi.fn();
    renderCard(onOpen);
    fireEvent.click(await screen.findByRole("button", { name: /Running: Kometa run/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

function withinCardProgress(card: HTMLElement) {
  return card.querySelector('[role="progressbar"]') as HTMLElement;
}
