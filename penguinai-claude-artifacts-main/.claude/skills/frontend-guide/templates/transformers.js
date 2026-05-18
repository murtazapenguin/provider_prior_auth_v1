
/**
 * Data Transformation Utilities
 *
 * Transform data between backend API format and PDFViewer component format.
 *
 * PDFViewer expects specific data structures:
 * - documentData: { files: [...], presigned_urls: { [filename]: { [pageNum]: url } } }
 * - boundingBoxes: [{ page_number, document_name, label: [], bbox: [[8-coords]] }]
 *
 * Backend typically provides:
 * - Document: { id, name, pages: [{ page_number, image_url }] }
 * - Annotations: [{ id, page_number, document_name, label, coordinates: { x1-x4, y1-y4 } }]
 */

// ============================================================
// DOCUMENT DATA TRANSFORMERS
// ============================================================

/**
 * Transform a single backend document to PDFViewer documentData format
 *
 * @param {object} backendDocument - Document from backend API
 * @param {string} backendDocument.id - Document ID
 * @param {string} backendDocument.name - Document filename
 * @param {Array} backendDocument.pages - Array of page objects
 * @param {number} backendDocument.pages[].page_number - Page number (1-indexed)
 * @param {string} backendDocument.pages[].image_url - Presigned URL for page image
 * @returns {object} PDFViewer documentData format
 *
 * @example
 * // Backend format:
 * {
 *   id: "doc-123",
 *   name: "report.pdf",
 *   pages: [
 *     { page_number: 1, image_url: "https://..." },
 *     { page_number: 2, image_url: "https://..." }
 *   ]
 * }
 *
 * // PDFViewer format:
 * {
 *   files: ["report.pdf"],
 *   presigned_urls: {
 *     "report.pdf": {
 *       "1": "https://...",
 *       "2": "https://..."
 *     }
 *   }
 * }
 */
export const transformToDocumentData = (backendDocument) => {
  if (!backendDocument) {
    return null;
  }

  const { name, pages = [] } = backendDocument;

  // Build presigned_urls object
  const presigned_urls = {
    [name]: pages.reduce((acc, page) => {
      acc[page.page_number.toString()] = page.image_url;
      return acc;
    }, {}),
  };

  return {
    files: [name],
    presigned_urls,
  };
};

/**
 * Transform multiple documents to PDFViewer documentData format
 *
 * @param {Array} documents - Array of backend documents
 * @returns {object} PDFViewer documentData format with multiple files
 *
 * @example
 * const documentData = transformMultipleDocuments([doc1, doc2]);
 * // { files: ["doc1.pdf", "doc2.pdf"], presigned_urls: { ... } }
 */
export const transformMultipleDocuments = (documents) => {
  if (!documents || documents.length === 0) {
    return null;
  }

  const files = documents.map((doc) => doc.name);
  const presigned_urls = {};

  documents.forEach((doc) => {
    presigned_urls[doc.name] = doc.pages.reduce((acc, page) => {
      acc[page.page_number.toString()] = page.image_url;
      return acc;
    }, {});
  });

  return { files, presigned_urls };
};

// ============================================================
// BOUNDING BOX TRANSFORMERS
// ============================================================

/**
 * Transform backend bounding boxes to PDFViewer format
 *
 * Groups annotations by document and page, converting coordinate format.
 *
 * @param {Array} backendBoxes - Array of annotations from backend
 * @param {string} backendBoxes[].id - Annotation ID
 * @param {number} backendBoxes[].page_number - Page number
 * @param {string} backendBoxes[].document_name - Document filename
 * @param {string} backendBoxes[].label - Annotation label
 * @param {object} backendBoxes[].coordinates - 8-point coordinates
 * @returns {Array} PDFViewer boundingBoxes format
 *
 * @example
 * // Backend format:
 * [{
 *   id: "ann-1",
 *   page_number: 1,
 *   document_name: "report.pdf",
 *   label: "Important Text",
 *   coordinates: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.2, x3: 0.3, y3: 0.4, x4: 0.1, y4: 0.4 }
 * }]
 *
 * // PDFViewer format (page_number as INTEGER):
 * [{
 *   document_name: "report.pdf",
 *   page_number: 1,
 *   label: ["Important Text"],
 *   bbox: [[0.1, 0.2, 0.3, 0.2, 0.3, 0.4, 0.1, 0.4]]
 * }]
 */
export const transformToBoundingBoxes = (backendBoxes) => {
  if (!backendBoxes || backendBoxes.length === 0) {
    return [];
  }

  // Group by document_name and page_number
  const grouped = backendBoxes.reduce((acc, box) => {
    const key = `${box.document_name}-${box.page_number}`;

    if (!acc[key]) {
      acc[key] = {
        document_name: box.document_name,
        page_number: box.page_number,  // Keep as INTEGER per canonical format
        label: [],
        bbox: [],
      };
    }

    // Add label
    acc[key].label.push(box.label || '');

    // Convert coordinates object to 8-point array
    const coords = box.coordinates;
    acc[key].bbox.push([
      coords.x1, coords.y1,
      coords.x2, coords.y2,
      coords.x3, coords.y3,
      coords.x4, coords.y4,
    ]);

    return acc;
  }, {});

  return Object.values(grouped);
};

/**
 * Transform PDFViewer annotation callback data to backend format
 *
 * Flattens grouped annotations into individual records.
 *
 * @param {Array} pdfViewerAnnotation - Annotations from PDFViewer onAnnotationAdd callback
 * @returns {Array} Backend annotation format
 *
 * @example
 * // PDFViewer callback data (page_number as INTEGER):
 * [{
 *   document_name: "report.pdf",
 *   page_number: 1,
 *   bbox: [[0.1, 0.2, 0.3, 0.2, 0.3, 0.4, 0.1, 0.4]]
 * }]
 *
 * // Backend format:
 * [{
 *   document_name: "report.pdf",
 *   page_number: 1,
 *   label: "",
 *   coordinates: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.2, x3: 0.3, y3: 0.4, x4: 0.1, y4: 0.4 }
 * }]
 */
export const transformAnnotationForBackend = (pdfViewerAnnotation) => {
  if (!pdfViewerAnnotation || pdfViewerAnnotation.length === 0) {
    return [];
  }

  return pdfViewerAnnotation.flatMap((group) =>
    group.bbox.map((bbox, index) => ({
      document_name: group.document_name,
      page_number: group.page_number,  // Already INTEGER, no conversion needed
      label: group.label?.[index] || '',
      coordinates: {
        x1: bbox[0],
        y1: bbox[1],
        x2: bbox[2],
        y2: bbox[3],
        x3: bbox[4],
        y3: bbox[5],
        x4: bbox[6],
        y4: bbox[7],
      },
    }))
  );
};

// ============================================================
// SEARCH RESULTS TRANSFORMERS
// ============================================================

/**
 * Transform backend search results to PDFViewer searchResults format
 *
 * @param {object} backendResults - Search results from backend
 * @returns {object} PDFViewer searchResults format
 *
 * @example
 * // Backend format:
 * {
 *   query: "search term",
 *   matches: [{
 *     document_name: "report.pdf",
 *     page_number: 1,
 *     text: "matching text",
 *     coordinates: { x1, y1, ... }
 *   }]
 * }
 *
 * // PDFViewer format (page_number as INTEGER):
 * {
 *   document_id: "...",
 *   search_string: "search term",
 *   total_matches: 1,
 *   results: [{
 *     document_name: "report.pdf",
 *     page_number: 1,
 *     bbox: [[8-coords]],
 *     text_snippet: "matching text",
 *     match_score: 100
 *   }]
 * }
 */
export const transformSearchResults = (backendResults) => {
  if (!backendResults) {
    return null;
  }

  const results = (backendResults.matches || []).map((match) => ({
    document_name: match.document_name,
    page_number: match.page_number,  // Keep as INTEGER per canonical format
    bbox: [
      [
        match.coordinates.x1,
        match.coordinates.y1,
        match.coordinates.x2,
        match.coordinates.y2,
        match.coordinates.x3,
        match.coordinates.y3,
        match.coordinates.x4,
        match.coordinates.y4,
      ],
    ],
    text_snippet: match.text,
    match_score: match.score || 100,
  }));

  return {
    document_id: backendResults.document_id || '',
    search_string: backendResults.query || '',
    total_matches: results.length,
    results,
  };
};

// ============================================================
// COORDINATE UTILITIES
// ============================================================

/**
 * Convert 4-point bounding box (x_min, y_min, x_max, y_max) to 8-point format
 *
 * @param {object} box - 4-point bounding box
 * @param {number} box.x_min - Left edge (normalized 0-1)
 * @param {number} box.y_min - Top edge (normalized 0-1)
 * @param {number} box.x_max - Right edge (normalized 0-1)
 * @param {number} box.y_max - Bottom edge (normalized 0-1)
 * @returns {Array} 8-point array [x1, y1, x2, y2, x3, y3, x4, y4]
 *
 * Point order: top-left, top-right, bottom-right, bottom-left
 */
export const fourPointToEightPoint = (box) => {
  const { x_min, y_min, x_max, y_max } = box;
  return [
    x_min, y_min, // top-left
    x_max, y_min, // top-right
    x_max, y_max, // bottom-right
    x_min, y_max, // bottom-left
  ];
};

/**
 * Convert 8-point bounding box to 4-point format (min/max)
 *
 * @param {Array} coords - 8-point array [x1, y1, x2, y2, x3, y3, x4, y4]
 * @returns {object} 4-point bounding box { x_min, y_min, x_max, y_max }
 */
export const eightPointToFourPoint = (coords) => {
  const xCoords = [coords[0], coords[2], coords[4], coords[6]];
  const yCoords = [coords[1], coords[3], coords[5], coords[7]];

  return {
    x_min: Math.min(...xCoords),
    y_min: Math.min(...yCoords),
    x_max: Math.max(...xCoords),
    y_max: Math.max(...yCoords),
  };
};

/**
 * Calculate pixel coordinates from normalized coordinates
 *
 * @param {Array} normalizedCoords - 8-point normalized coordinates
 * @param {number} imageWidth - Rendered image width in pixels
 * @param {number} imageHeight - Rendered image height in pixels
 * @returns {object} Pixel bounding box { left, top, width, height }
 */
export const normalizedToPixels = (normalizedCoords, imageWidth, imageHeight) => {
  const fourPoint = eightPointToFourPoint(normalizedCoords);

  return {
    left: fourPoint.x_min * imageWidth,
    top: fourPoint.y_min * imageHeight,
    width: (fourPoint.x_max - fourPoint.x_min) * imageWidth,
    height: (fourPoint.y_max - fourPoint.y_min) * imageHeight,
  };
};

/**
 * Validate bounding box coordinates
 *
 * @param {Array} coords - 8-point coordinates
 * @returns {boolean} True if valid (all values 0-1)
 */
export const isValidBoundingBox = (coords) => {
  if (!Array.isArray(coords) || coords.length !== 8) {
    return false;
  }

  return coords.every((val) => typeof val === 'number' && val >= 0 && val <= 1);
};
