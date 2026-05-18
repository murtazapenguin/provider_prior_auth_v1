/**
 * React Query Hooks for PDF Document Processing Application
 *
 * These hooks provide data fetching, caching, and mutation capabilities
 * for documents, annotations, and processing status.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';

// ============================================================
// DOCUMENT HOOKS
// ============================================================

/**
 * Fetch all documents for the current user
 *
 * @returns {UseQueryResult} Query result with documents array
 *
 * @example
 * const { data: documents, isLoading, error } = useDocuments();
 */
export const useDocuments = () => {
  return useQuery({
    queryKey: ['documents'],
    queryFn: async () => {
      const response = await apiClient.get('/documents');
      return response.data;
    },
  });
};

/**
 * Fetch a single document with its pages
 *
 * @param {string} documentId - The document ID to fetch
 * @returns {UseQueryResult} Query result with document data
 *
 * Expected response format:
 * {
 *   id: string,
 *   name: string,
 *   status: 'processing' | 'completed' | 'failed',
 *   pages: [{ page_number: number, image_url: string }]
 * }
 *
 * @example
 * const { data: document, isLoading } = useDocument(documentId);
 */
export const useDocument = (documentId) => {
  return useQuery({
    queryKey: ['document', documentId],
    queryFn: async () => {
      const response = await apiClient.get(`/documents/${documentId}`);
      return response.data;
    },
    enabled: !!documentId,
  });
};

/**
 * Upload a new document
 *
 * @returns {UseMutationResult} Mutation for uploading files
 *
 * @example
 * const uploadDocument = useUploadDocument();
 *
 * const handleUpload = (file) => {
 *   uploadDocument.mutate(file, {
 *     onSuccess: (data) => {
 *       console.log('Uploaded:', data.id);
 *       navigate(`/documents/${data.id}`);
 *     },
 *     onError: (error) => {
 *       console.error('Upload failed:', error.message);
 *     }
 *   });
 * };
 */
export const useUploadDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await apiClient.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate documents list to refetch
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
};

/**
 * Delete a document
 *
 * @returns {UseMutationResult} Mutation for deleting documents
 *
 * @example
 * const deleteDocument = useDeleteDocument();
 * deleteDocument.mutate(documentId);
 */
export const useDeleteDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId) => {
      const response = await apiClient.delete(`/documents/${documentId}`);
      return response.data;
    },
    onSuccess: (_, documentId) => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.removeQueries({ queryKey: ['document', documentId] });
      queryClient.removeQueries({ queryKey: ['annotations', documentId] });
    },
  });
};

// ============================================================
// PROCESSING STATUS HOOKS
// ============================================================

/**
 * Poll for document processing status
 *
 * Automatically polls every 3 seconds until status is COMPLETED or FAILED
 *
 * @param {string} documentId - The document ID to check
 * @returns {UseQueryResult} Query result with status data
 *
 * Expected response format:
 * {
 *   status: 'processing' | 'completed' | 'failed',
 *   progress: number (0-100),
 *   message?: string
 * }
 *
 * @example
 * const { data: status } = useProcessingStatus(documentId);
 *
 * if (status?.status === 'processing') {
 *   return <ProgressBar value={status.progress} />;
 * }
 */
export const useProcessingStatus = (documentId) => {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['processing-status', documentId],
    queryFn: async () => {
      const response = await apiClient.get(`/documents/${documentId}/status`);
      return response.data;
    },
    enabled: !!documentId,
    // Poll every 3 seconds while processing
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') {
        // Stop polling and invalidate document data
        if (status === 'completed') {
          queryClient.invalidateQueries({ queryKey: ['document', documentId] });
        }
        return false;
      }
      return 3000;
    },
  });
};

// ============================================================
// ANNOTATION HOOKS
// ============================================================

/**
 * Fetch annotations for a document
 *
 * @param {string} documentId - The document ID
 * @returns {UseQueryResult} Query result with annotations array
 *
 * Expected response format:
 * [{
 *   id: string,
 *   page_number: number,
 *   document_name: string,
 *   label: string,
 *   coordinates: { x1, y1, x2, y2, x3, y3, x4, y4 }
 * }]
 *
 * @example
 * const { data: annotations } = useAnnotations(documentId);
 * const boundingBoxes = transformToBoundingBoxes(annotations);
 */
export const useAnnotations = (documentId) => {
  return useQuery({
    queryKey: ['annotations', documentId],
    queryFn: async () => {
      const response = await apiClient.get(`/documents/${documentId}/annotations`);
      return response.data;
    },
    enabled: !!documentId,
  });
};

/**
 * Save annotations for a document
 *
 * @param {string} documentId - The document ID
 * @returns {UseMutationResult} Mutation for saving annotations
 *
 * @example
 * const saveAnnotations = useSaveAnnotations(documentId);
 *
 * const handleAnnotationAdd = (pdfViewerData) => {
 *   const backendFormat = transformAnnotationForBackend(pdfViewerData);
 *   saveAnnotations.mutate(backendFormat, {
 *     onSuccess: () => {
 *       toast.success('Annotations saved');
 *     }
 *   });
 * };
 */
export const useSaveAnnotations = (documentId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annotations) => {
      const response = await apiClient.post(
        `/documents/${documentId}/annotations`,
        { annotations }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations', documentId] });
    },
  });
};

/**
 * Delete a single annotation
 *
 * @param {string} documentId - The document ID
 * @returns {UseMutationResult} Mutation for deleting annotations
 *
 * @example
 * const deleteAnnotation = useDeleteAnnotation(documentId);
 * deleteAnnotation.mutate(annotationId);
 */
export const useDeleteAnnotation = (documentId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annotationId) => {
      const response = await apiClient.delete(
        `/documents/${documentId}/annotations/${annotationId}`
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations', documentId] });
    },
  });
};

// ============================================================
// SEARCH HOOKS
// ============================================================

/**
 * Search within a document
 *
 * @param {string} documentId - The document ID
 * @returns {UseMutationResult} Mutation for searching
 *
 * Expected response format (matching PDFViewer searchResults):
 * {
 *   document_id: string,
 *   search_string: string,
 *   total_matches: number,
 *   results: [{
 *     document_name: string,
 *     page_number: number,
 *     bbox: [[x1, y1, x2, y2, x3, y3, x4, y4]],
 *     text_snippet: string,
 *     match_score: number
 *   }]
 * }
 *
 * @example
 * const searchDocument = useSearchDocument(documentId);
 *
 * const handleSearch = (query) => {
 *   searchDocument.mutate(query, {
 *     onSuccess: (results) => {
 *       setSearchResults(results);
 *     }
 *   });
 * };
 */
export const useSearchDocument = (documentId) => {
  return useMutation({
    mutationFn: async (query) => {
      const response = await apiClient.post(
        `/documents/${documentId}/search`,
        { query }
      );
      return response.data;
    },
  });
};

// ============================================================
// COMBINED DOCUMENT VIEWER HOOK
// ============================================================

/**
 * Combined hook for document viewer page
 *
 * Fetches document, annotations, and handles processing status
 *
 * @param {string} documentId - The document ID
 * @returns {object} Combined data and loading states
 *
 * @example
 * const {
 *   document,
 *   annotations,
 *   status,
 *   isLoading,
 *   isProcessing,
 *   isReady
 * } = useDocumentViewer(documentId);
 */
export const useDocumentViewer = (documentId) => {
  const documentQuery = useDocument(documentId);
  const annotationsQuery = useAnnotations(documentId);
  const statusQuery = useProcessingStatus(documentId);

  const isLoading = documentQuery.isLoading || annotationsQuery.isLoading;
  const isProcessing = statusQuery.data?.status === 'processing';
  const isReady = statusQuery.data?.status === 'completed' && !isLoading;

  return {
    document: documentQuery.data,
    annotations: annotationsQuery.data,
    status: statusQuery.data,
    isLoading,
    isProcessing,
    isReady,
    error: documentQuery.error || annotationsQuery.error,
    refetch: () => {
      documentQuery.refetch();
      annotationsQuery.refetch();
    },
  };
};
