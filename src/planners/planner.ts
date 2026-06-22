/**
 * DECIDE layer contract.
 *
 * Both the heuristic and AI planners implement this one interface, so the agent
 * loop is identical regardless of which "brain" is in use — switching is a
 * single line in the factory.
 */
import { PageSnapshot, Goal, Action } from '../types';

export interface Planner {
  readonly name: string;
  /** Given the current perception and the goal, return the next action(s). */
  plan(snapshot: PageSnapshot, goal: Goal): Promise<Action[]>;
}
