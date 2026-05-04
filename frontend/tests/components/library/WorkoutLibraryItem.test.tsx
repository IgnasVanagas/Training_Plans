import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";

import { WorkoutLibraryItem } from "../../../src/components/library/WorkoutLibraryItem";
import type { SavedWorkout } from "../../../src/types/workout";

const sampleWorkout: SavedWorkout = {
  id: 1,
  coach_id: 0,
  title: "Tempo run",
  description: "20 min tempo",
  sport_type: "Running",
  tags: ["Tempo", "Threshold", "Speed"],
  structure: [
    { id: "s1", type: "block", category: "work", duration: { type: "time", value: 600 }, target: { type: "rpe", value: 7 } },
  ] as any,
  is_favorite: false,
  created_at: "2026-01-01",
};

const renderItem = (props: Partial<React.ComponentProps<typeof WorkoutLibraryItem>> = {}) => {
  const defaults = {
    workout: sampleWorkout,
    onToggleFavorite: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
  };
  return {
    handlers: defaults,
    ...render(
      <MantineProvider>
        <WorkoutLibraryItem {...defaults} {...props} />
      </MantineProvider>
    ),
  };
};

describe("WorkoutLibraryItem", () => {
  it("renders workout title, description, sport, and tags", () => {
    renderItem();
    expect(screen.getByText("Tempo run")).toBeInTheDocument();
    expect(screen.getByText("20 min tempo")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Tempo")).toBeInTheDocument();
  });

  it("invokes toggleFavorite, edit and delete handlers", async () => {
    const user = userEvent.setup();
    const { handlers } = renderItem();

    const buttons = screen.getAllByRole("button");
    // Order in component: favorite, edit, delete
    await user.click(buttons[0]);
    expect(handlers.onToggleFavorite).toHaveBeenCalledWith(expect.anything(), 1, true);

    await user.click(buttons[1]);
    expect(handlers.onEdit).toHaveBeenCalledWith(expect.anything(), sampleWorkout);

    await user.click(buttons[2]);
    expect(handlers.onDelete).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it("hides the action buttons and shows Template badge for templates", () => {
    renderItem({ workout: { ...sampleWorkout, id: -1 }, isTemplate: true });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Template")).toBeInTheDocument();
  });

  it("calls onSelect when the card is clicked in selection mode", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderItem({ onSelect });

    await user.click(screen.getByText("Tempo run"));
    expect(onSelect).toHaveBeenCalledWith(sampleWorkout);
  });
});
