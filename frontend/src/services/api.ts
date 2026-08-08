/**
 * API 客戶端
 * 封裝所有後端 API 調用
 */

import axios, { type AxiosError } from 'axios';
import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  ProjectImportResult,
  ProjectList,
  HistorySnapshot,
  HistorySnapshotCreate,
  HistorySnapshotList,
  FileNode,
  FileContent,
  FileCreate,
  FileUpdate,
  FileRename,
  FileUploadResult,
  ProjectSymbolsResponse,
  SearchResponse,
  CompileResult,
  CompileRequest,
  SyncTexForwardResult,
  SyncTexReverseResult,
} from '@/types';

const API_BASE_URL = '/api';

const encodePath = (path: string): string => (
  path.split('/').map((part) => encodeURIComponent(part)).join('/')
);

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60 秒超時（編譯可能需要較長時間）
});

// 響應攔截器：統一處理錯誤
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ detail?: string; message?: string }>) => {
    // 提取錯誤訊息
    let message = '請求失敗';
    
    if (error.response) {
      // 服務器返回錯誤響應
      const { status, data } = error.response;
      message = data?.detail || data?.message || `伺服器錯誤 (${status})`;
      
      // 根據狀態碼提供更具體的訊息
      switch (status) {
        case 400:
          message = `請求錯誤: ${message}`;
          break;
        case 404:
          message = `找不到資源: ${message}`;
          break;
        case 409:
          message = `衝突: ${message}`;
          break;
        case 500:
          message = `伺服器內部錯誤: ${message}`;
          break;
      }
    } else if (error.code === 'ECONNABORTED') {
      // 注意：超時的 error 也帶有 request，必須先判斷 ECONNABORTED
      message = '請求超時，請稍後再試';
    } else if (error.request) {
      // 請求已發出但沒有收到響應
      message = '無法連接到伺服器，請檢查網路連接';
    }
    
    console.error('API Error:', message, error);
    
    // 返回帶有更好錯誤訊息的 rejected promise
    return Promise.reject(new Error(message));
  }
);

// ===== 項目 API =====

export const projectAPI = {
  /**
   * 獲取所有項目
   */
  async list(): Promise<ProjectList> {
    const response = await apiClient.get<ProjectList>('/projects');
    return response.data;
  },

  /**
   * 獲取單個項目
   */
  async get(projectId: string): Promise<Project> {
    const response = await apiClient.get<Project>(`/projects/${projectId}`);
    return response.data;
  },

  /**
   * 創建新項目
   */
  async create(data: ProjectCreate): Promise<Project> {
    const response = await apiClient.post<Project>('/projects', data);
    return response.data;
  },

  /**
   * 更新項目設定
   */
  async update(projectId: string, data: ProjectUpdate): Promise<Project> {
    const response = await apiClient.patch<Project>(`/projects/${projectId}`, data);
    return response.data;
  },

  /**
   * 刪除項目
   */
  async delete(projectId: string): Promise<void> {
    await apiClient.delete(`/projects/${projectId}`);
  },

  /**
   * 重新命名項目（目錄名即 ID，重新命名後 ID 一併改變）
   */
  async rename(projectId: string, newName: string): Promise<Project> {
    const response = await apiClient.patch<Project>(
      `/projects/${encodeURIComponent(projectId)}/rename`,
      { new_name: newName }
    );
    return response.data;
  },

  /**
   * 複製項目（不含歷史快照）
   */
  async duplicate(projectId: string, newName?: string): Promise<Project> {
    const response = await apiClient.post<Project>(
      `/projects/${encodeURIComponent(projectId)}/duplicate`,
      newName?.trim() ? { new_name: newName.trim() } : {}
    );
    return response.data;
  },

  /**
   * 項目原始檔 ZIP 的下載網址
   */
  getExportUrl(projectId: string): string {
    return `/api/projects/${encodeURIComponent(projectId)}/export`;
  },
};

// ===== 歷史 API =====

export const historyAPI = {
  async list(projectId: string, filePath?: string): Promise<HistorySnapshotList> {
    const response = await apiClient.get<HistorySnapshotList>(
      `/projects/${projectId}/history`,
      { params: filePath ? { file_path: filePath } : undefined }
    );
    return response.data;
  },

  async create(projectId: string, data: HistorySnapshotCreate): Promise<HistorySnapshot> {
    const response = await apiClient.post<HistorySnapshot>(`/projects/${projectId}/history`, data);
    return response.data;
  },

  async restore(projectId: string, snapshotId: string): Promise<HistorySnapshot> {
    const response = await apiClient.post<HistorySnapshot>(
      `/projects/${projectId}/history/restore`,
      { snapshot_id: snapshotId }
    );
    return response.data;
  },
};

// ===== 項目匯入 API =====

export const projectImportAPI = {
  async importZip(file: File, projectName?: string): Promise<ProjectImportResult> {
    const formData = new FormData();
    formData.append('upload', file);
    if (projectName?.trim()) formData.append('project_name', projectName.trim());

    const response = await apiClient.post<ProjectImportResult>('/projects/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return response.data;
  },
};

// ===== 文件 API =====

export const fileAPI = {
  /**
   * 獲取文件樹
   */
  async getTree(projectId: string): Promise<FileNode[]> {
    const response = await apiClient.get<FileNode[]>(`/files/${projectId}`);
    return response.data;
  },

  /**
   * 讀取文件內容
   */
  async read(projectId: string, filePath: string): Promise<FileContent> {
    const response = await apiClient.get<FileContent>(
      `/files/${projectId}/content/${encodePath(filePath)}`
    );
    return response.data;
  },

  /**
   * 更新文件內容
   */
  async update(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    await apiClient.put(`/files/${projectId}/content/${encodePath(filePath)}`, {
      content,
    } as FileUpdate);
  },

  /**
   * 創建文件或目錄
   */
  async create(projectId: string, data: FileCreate): Promise<void> {
    await apiClient.post(`/files/${projectId}`, data);
  },

  /**
   * 刪除文件或目錄
   */
  async delete(projectId: string, filePath: string): Promise<void> {
    await apiClient.delete(`/files/${projectId}/${encodePath(filePath)}`);
  },

  /**
   * 重命名文件或目錄
   */
  async rename(
    projectId: string,
    filePath: string,
    newName: string
  ): Promise<{ new_path: string }> {
    const response = await apiClient.patch(
      `/files/${projectId}/rename/${encodePath(filePath)}`,
      { new_name: newName } as FileRename
    );
    return response.data;
  },

  async upload(projectId: string, filePath: string, file: File): Promise<FileUploadResult> {
    const formData = new FormData();
    formData.append('upload', file);
    const response = await apiClient.post<FileUploadResult>(
      `/files/${projectId}/upload/${encodePath(filePath)}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      }
    );
    return response.data;
  },

  async search(
    projectId: string,
    query: string,
    options?: { caseSensitive?: boolean; maxResults?: number }
  ): Promise<SearchResponse> {
    const response = await apiClient.get<SearchResponse>(`/files/${projectId}/search`, {
      params: {
        q: query,
        case_sensitive: options?.caseSensitive ?? false,
        max_results: options?.maxResults ?? 100,
      },
    });
    return response.data;
  },

  async getSymbols(projectId: string): Promise<ProjectSymbolsResponse> {
    const response = await apiClient.get<ProjectSymbolsResponse>(`/files/${projectId}/symbols`);
    return response.data;
  },
};

// ===== 編譯 API =====

export const compileAPI = {
  /**
   * 編譯項目
   */
  async compile(request: CompileRequest): Promise<CompileResult> {
    const response = await apiClient.post<CompileResult>(
      `/compile/${request.project_id}`,
      request
    );
    return response.data;
  },

  /**
   * 獲取 PDF
   */
  getPdfUrl(projectId: string, mainFile: string = 'main.tex'): string {
    return `/api/compile/${projectId}/pdf?main_file=${encodeURIComponent(mainFile)}`;
  },

  async forwardSync(
    projectId: string,
    params: { mainFile: string; sourceFile: string; line: number; column?: number }
  ): Promise<SyncTexForwardResult> {
    const response = await apiClient.get<SyncTexForwardResult>(
      `/compile/${projectId}/synctex/forward`,
      {
        params: {
          main_file: params.mainFile,
          source_file: params.sourceFile,
          line: params.line,
          column: params.column ?? 1,
        },
      }
    );
    return response.data;
  },

  async reverseSync(
    projectId: string,
    params: { mainFile: string; page: number; x: number; y: number }
  ): Promise<SyncTexReverseResult> {
    const response = await apiClient.get<SyncTexReverseResult>(
      `/compile/${projectId}/synctex/reverse`,
      {
        params: {
          main_file: params.mainFile,
          page: params.page,
          x: params.x,
          y: params.y,
        },
      }
    );
    return response.data;
  },
};

export default {
  project: projectAPI,
  history: historyAPI,
  projectImport: projectImportAPI,
  file: fileAPI,
  compile: compileAPI,
};
