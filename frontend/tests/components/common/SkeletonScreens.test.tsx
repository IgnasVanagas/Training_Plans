import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import {
  ActivitiesListSkeleton,
  ActivityDetailSkeleton,
  CalendarMonthSkeleton,
  CalendarWeekSkeleton,
} from "../../../src/components/common/SkeletonScreens";

const wrap = (node: React.ReactNode) =>
  render(<MantineProvider>{node}</MantineProvider>);

describe("SkeletonScreens", () => {
  it("renders calendar week and month skeletons without crashing", () => {
    const { container: weekContainer } = wrap(<CalendarWeekSkeleton />);
    expect(weekContainer.firstChild).toBeTruthy();

    const { container: monthContainer } = wrap(<CalendarMonthSkeleton />);
    expect(monthContainer.firstChild).toBeTruthy();
  });

  it("renders activities list skeletons with the requested count", () => {
    const { container } = wrap(<ActivitiesListSkeleton count={3} />);
    // Each card uses Mantine "Card" with classname "mantine-Card-root"
    const cards = container.querySelectorAll('[class*="Card"]');
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });

  it("renders activities list skeleton with default count when omitted", () => {
    const { container } = wrap(<ActivitiesListSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders activity detail skeleton", () => {
    const { container } = wrap(<ActivityDetailSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });
});
