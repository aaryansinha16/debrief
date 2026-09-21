'use client';

import { Component, type ReactNode } from 'react';

interface StageBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

// A browser without WebGL (or a driver that throws) gets the flat map instead of a blank stage.
export class StageBoundary extends Component<StageBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
