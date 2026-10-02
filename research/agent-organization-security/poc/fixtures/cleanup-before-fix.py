"""Pre-fix cleanup AST snapshot used only as the regression negative control."""
try:
    pass
finally:
    if 'recovered_process' in locals() and recovered_process is not None and (recovered_process.poll() is None):
        subprocess.run(ssh('actor-a') + ['sudo poweroff'], capture_output=True, timeout=10)
        recovered_process.wait(timeout=60)
    for tunnel in tunnels:
        tunnel.terminate()
        tunnel.wait(timeout=5)
        tunnel.stderr.close()
    for process in reversed(processes):
        if process.is_alive():
            process.terminate()
        process.join(timeout=5)
