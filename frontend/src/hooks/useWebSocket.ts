/**
 * WebSocket Hook
 * 用於即時編譯狀態推送
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { CompileProgress } from '@/types';

interface UseWebSocketOptions {
  onMessage?: (data: CompileProgress) => void;
  onError?: (error: Event) => void;
  onClose?: () => void;
}

const compileStatuses = new Set(['pending', 'compiling', 'success', 'error']);

function isCompileProgress(value: unknown): value is CompileProgress {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.status === 'string'
    && compileStatuses.has(data.status)
    && typeof data.progress === 'number'
    && typeof data.message === 'string'
  );
}

export function useWebSocket(projectId: string | null, options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!projectId) return;

    // 建立 WebSocket 連接
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/compile/ws/${projectId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const parsedMessage: unknown = JSON.parse(event.data);
        if (!isCompileProgress(parsedMessage)) {
          throw new Error('WebSocket 訊息格式無效');
        }
        optionsRef.current.onMessage?.(parsedMessage);
      } catch (error) {
        console.error('解析 WebSocket 訊息失敗:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket 錯誤:', error);
      optionsRef.current.onError?.(error);
    };

    ws.onclose = () => {
      setIsConnected(false);
      optionsRef.current.onClose?.();
    };

    // 清理函數：CONNECTING 中的 socket 也要關閉，並解除 handler，
    // 避免切換專案後殘留的連線繼續把訊息塞給已卸載的元件
    return () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [projectId]);

  // 發送編譯請求
  const sendCompile = useCallback((mainFile?: string, compiler: 'xelatex' | 'pdflatex' = 'xelatex') => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'compile',
        main_file: mainFile,
        compiler,
      }));
    }
  }, []);

  return {
    isConnected,
    sendCompile,
  };
}
