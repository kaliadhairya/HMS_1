import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('HMS Application ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoDashboard = () => {
    window.location.href = '/dashboard';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--bg, #f8fafc)',
          fontFamily: 'var(--font-body, system-ui, sans-serif)'
        }}>
          <div style={{
            maxWidth: '560px',
            width: '100%',
            background: 'var(--surface, #ffffff)',
            borderRadius: '16px',
            padding: '36px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
            border: '1px solid var(--border, #e2e8f0)',
            textAlign: 'center'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              margin: '0 auto 20px'
            }}>
              ⚠️
            </div>

            <h2 style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              color: 'var(--text-primary, #0f172a)',
              margin: '0 0 10px'
            }}>
              Something Went Wrong
            </h2>

            <p style={{
              color: 'var(--text-secondary, #64748b)',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              margin: '0 0 24px'
            }}>
              The application encountered an unexpected error while rendering this page. You can try refreshing the page or returning to the dashboard.
            </p>

            {this.state.error && (
              <div style={{
                textAlign: 'left',
                background: 'var(--surface-2, #f1f5f9)',
                padding: '12px 16px',
                borderRadius: '8px',
                marginBottom: '24px',
                border: '1px solid var(--border, #e2e8f0)',
                fontSize: '0.8rem',
                color: '#ef4444',
                fontFamily: 'monospace',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                maxHeight: '140px'
              }}>
                {this.state.error.toString()}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '10px 20px',
                  borderRadius: '10px',
                  background: 'var(--primary-color, #0f766e)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s'
                }}
              >
                ↻ Reload Page
              </button>
              <button
                onClick={this.handleGoDashboard}
                style={{
                  padding: '10px 20px',
                  borderRadius: '10px',
                  background: 'transparent',
                  color: 'var(--text-primary, #0f172a)',
                  border: '1px solid var(--border, #cbd5e1)',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  cursor: 'pointer'
                }}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
