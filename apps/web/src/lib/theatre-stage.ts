// The flat map is the theatre (D-080); the 3D stage stays reachable by `?stage=3d`, outside the navigation.
export type TheatreStage = 'map' | '3d';

export const theatreStageOf = (value: unknown): TheatreStage => (value === '3d' ? '3d' : 'map');
