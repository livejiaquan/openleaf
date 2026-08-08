/**
 * Debounce Hook
 * 用於延遲觸發事件（如自動編譯）
 */

import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay: number = 500): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // 設置定時器
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // 清理函數：取消上一次的定時器
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
