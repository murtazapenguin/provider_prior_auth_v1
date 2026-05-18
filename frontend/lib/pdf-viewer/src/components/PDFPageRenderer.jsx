import { useEffect, useMemo, useRef, useState } from "react";
import { AnnotationCanvas } from "./AnnotationCanvas";

export const PDFPageRenderer = ({
  imageUrl,
  pageNumber,
  zoom,
  boundingBoxes = [], // Now expects array of objects
  currentDocument,
  annotationMode,
  onAnnotationAdd,
  searchResults = null,
  currentSearchIndex = -1,
  onScrollToBoundingBox,
  preloadedImages = new Map(),
  isTransitioning = false,
  // NEW: Bounding box annotation props
  isAnnotationMode = false,
  onBoundingBoxCreate,
  drawnAnnotations = [],
  onDeleteAnnotation,
  // NEW: Existing bbox props
  deletedExistingBboxes = new Set(),
  onDeleteExistingBbox,
  // NEW: Selected region highlighting
  selectedRegion = null,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({
    width: 0,
    height: 0,
  });
  const imageRef = useRef(null);
  const containerRef = useRef(null);

  // NEW: Selection state for bounding box annotation mode
  const [isSelectingBBox, setIsSelectingBBox] = useState(false);
  const [selectionStartBBox, setSelectionStartBBox] = useState(null);
  const [selectionCurrentBBox, setSelectionCurrentBBox] = useState(null);

  // NEW: Hover state for annotation deletion

  const [mousePosition, setMousePosition] = useState(null);

  const handleImageLoad = () => {
    setImageLoaded(true);
    if (imageRef.current) {
      setImageDimensions({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
    }
  };

  const handleImageError = () => {
    console.error(`Failed to load image: ${imageUrl}`);
  };

  // Check if image is preloaded and use it
  useEffect(() => {
    if (preloadedImages.has(imageUrl)) {
      const preloadedImg = preloadedImages.get(imageUrl);
      if (preloadedImg.complete) {
        setImageLoaded(true);
        setImageDimensions({
          width: preloadedImg.naturalWidth,
          height: preloadedImg.naturalHeight,
        });
      }
    }
  }, [imageUrl, preloadedImages]);

  // Scroll to bounding boxes when image loads and dimensions are available
  useEffect(() => {
    if (
      !imageLoaded ||
      !imageDimensions.width ||
      !imageDimensions.height ||
      !onScrollToBoundingBox
    ) {
      return;
    }

    const scrollTimer = setTimeout(() => {
      // Priority 1: Scroll to current search result if available
      if (searchResults && searchResults.results && currentSearchIndex >= 0) {
        const currentResult = searchResults.results[currentSearchIndex];
        if (
          currentResult &&
          currentResult.document_name === currentDocument &&
          parseInt(currentResult.page_number) === pageNumber &&
          currentResult.bbox
        ) {
          onScrollToBoundingBox(
            currentResult.bbox,
            imageDimensions.width,
            imageDimensions.height,
            pageNumber
          );
          return;
        }
      }

      // Priority 2: Scroll to regular bounding boxes if available (updated for array structure)
      if (
        boundingBoxes &&
        Array.isArray(boundingBoxes) &&
        boundingBoxes.length > 0
      ) {
        const currentPageBboxes = boundingBoxes.filter(
          (bboxGroup) =>
            bboxGroup.document_name === currentDocument &&
            parseInt(bboxGroup.page_number) === pageNumber
        );

        if (currentPageBboxes.length > 0 && currentPageBboxes[0].bbox) {
          onScrollToBoundingBox(
            currentPageBboxes[0].bbox,
            imageDimensions.width,
            imageDimensions.height,
            pageNumber
          );
        }
      }
    }, 100);

    return () => clearTimeout(scrollTimer);
  }, [
    imageLoaded,
    imageDimensions,
    boundingBoxes,
    searchResults,
    currentSearchIndex,
    currentDocument,
    pageNumber,
    onScrollToBoundingBox,
  ]);

  // Helper function to normalize coordinates using rendered dimensions
  const normalizeCoordinates = (pixelCoords, imageElement) => {
    const { offsetWidth, offsetHeight } = imageElement;

    return {
      x_min: pixelCoords.x_min / offsetWidth,
      y_min: pixelCoords.y_min / offsetHeight,
      x_max: pixelCoords.x_max / offsetWidth,
      y_max: pixelCoords.y_max / offsetHeight,
    };
  };

  // Selection handlers
  const handleImageMouseDown = (e) => {
    if (isTransitioning) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Handle bounding box annotation mode selection
    if (isAnnotationMode) {
      setIsSelectingBBox(true);
      setSelectionStartBBox({ x, y });
      setSelectionCurrentBBox({ x, y });
      e.preventDefault();
      return;
    }
  };

  const handleImageMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Update mouse position for glowing cursor (annotation toolbar mode only)
    if (isAnnotationMode && !isTransitioning) {
      setMousePosition({ x, y });
    }

    if (isTransitioning) return;

    // Handle bounding box annotation mode selection
    if (isSelectingBBox && isAnnotationMode) {
      setSelectionCurrentBBox({ x, y });
      return;
    }
  };

  const handleImageMouseUp = (e) => {
    if (isTransitioning) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const imageElement = e.currentTarget;

    // Handle bounding box annotation mode selection
    if (
      isSelectingBBox &&
      isAnnotationMode &&
      selectionStartBBox &&
      imageElement
    ) {
      const pixelCoords = {
        x_min: Math.min(selectionStartBBox.x, x),
        y_min: Math.min(selectionStartBBox.y, y),
        x_max: Math.max(selectionStartBBox.x, x),
        y_max: Math.max(selectionStartBBox.y, y),
      };

      // Only create annotation if selection is big enough (minimum 10px in each direction)
      const minSize = 10;
      if (
        Math.abs(x - selectionStartBBox.x) >= minSize &&
        Math.abs(y - selectionStartBBox.y) >= minSize
      ) {
        const normalizedCoords = normalizeCoordinates(
          pixelCoords,
          imageElement
        );

        const selectionData = {
          ...normalizedCoords,
          document: currentDocument,
          page: pageNumber,
          pixelCoords: pixelCoords,
        };

        if (onBoundingBoxCreate) {
          onBoundingBoxCreate(selectionData);
        }
      }

      setIsSelectingBBox(false);
      setSelectionStartBBox(null);
      setSelectionCurrentBBox(null);
      return;
    }
  };

  const handleImageMouseLeave = () => {
    setMousePosition(null);
  };

  // Calculate highlight styles for existing functionality
  const getHighlightStyle = (bbox) => {
    if (!imageRef.current) return {};

    const imgWidth = imageRef.current.offsetWidth;
    const imgHeight = imageRef.current.offsetHeight;

    const baseLeft = bbox.x_min * imgWidth;
    const baseTop = bbox.y_min * imgHeight;
    const baseWidth = (bbox.x_max - bbox.x_min) * imgWidth;
    const baseHeight = (bbox.y_max - bbox.y_min) * imgHeight;

    const clearance = 8;
    const left = Math.max(0, baseLeft - clearance);
    const top = Math.max(0, baseTop - clearance);
    const right = Math.min(imgWidth, baseLeft + baseWidth + clearance);
    const bottom = Math.min(imgHeight, baseTop + baseHeight + clearance);

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    };
  };

  // NEW: Calculate styles for drawn bounding box annotations
  const getDrawnAnnotationStyle = (annotation) => {
    if (!imageRef.current) return {};

    const imgWidth = imageRef.current.offsetWidth;
    const imgHeight = imageRef.current.offsetHeight;

    // annotation.bbox format: [x1, y1, x2, y2, x3, y3, x4, y4]
    const [x1, y1, x2, y2, x3, y3, x4, y4] = annotation.bbox;

    const left = Math.min(x1, x2, x3, x4) * imgWidth;
    const top = Math.min(y1, y2, y3, y4) * imgHeight;
    const width =
      (Math.max(x1, x2, x3, x4) - Math.min(x1, x2, x3, x4)) * imgWidth;
    const height =
      (Math.max(y1, y2, y3, y4) - Math.min(y1, y2, y3, y4)) * imgHeight;

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  };

  // NEW: Calculate styles for existing bounding boxes (updated for array structure)
  const getExistingBboxStyle = (bbox) => {
    if (!imageRef.current) return {};

    const imgWidth = imageRef.current.offsetWidth;
    const imgHeight = imageRef.current.offsetHeight;

    // bbox format: [x1, y1, x2, y2, x3, y3, x4, y4]
    const [x1, y1, x2, y2, x3, y3, x4, y4] = bbox;

    const left = Math.min(x1, x2, x3, x4) * imgWidth;
    const top = Math.min(y1, y2, y3, y4) * imgHeight;
    const width =
      (Math.max(x1, x2, x3, x4) - Math.min(x1, x2, x3, x4)) * imgWidth;
    const height =
      (Math.max(y1, y2, y3, y4) - Math.min(y1, y2, y3, y4)) * imgHeight;

    const clearance = 8;
    const adjustedLeft = Math.max(0, left - clearance);
    const adjustedTop = Math.max(0, top - clearance);
    const adjustedRight = Math.min(imgWidth, left + width + clearance);
    const adjustedBottom = Math.min(imgHeight, top + height + clearance);

    return {
      left: `${adjustedLeft}px`,
      top: `${adjustedTop}px`,
      width: `${adjustedRight - adjustedLeft}px`,
      height: `${adjustedBottom - adjustedTop}px`,
    };
  };

  const containerStyle = {
    position: "relative",
    display: "inline-block",
    margin: 0,
    padding: 0,
  };

  const imageStyle = {
    display: "block",
    border: "1px solid #e0e0e0",
    boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
    verticalAlign: "top",
    margin: 0,
    padding: 0,
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    userSelect: "none",
    pointerEvents: isTransitioning ? "none" : "auto",
    cursor: isAnnotationMode ? "crosshair" : undefined,
  };

  const loadingStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
    border: "2px dashed #e0e0e0",
    borderRadius: "4px",
    minHeight: "400px",
    minWidth: "300px",
  };

  // Filter drawn annotations for current page and document
  const currentPageDrawnAnnotations = drawnAnnotations.filter(
    (annotation) =>
      annotation.document_name === currentDocument &&
      annotation.page_number === pageNumber
  );

  // NEW: Get existing bounding boxes for current page (filtered by deleted ones)
  const currentPageExistingBboxes = useMemo(() => {
    if (!boundingBoxes || !Array.isArray(boundingBoxes)) {
      return [];
    }

    return boundingBoxes.filter(
      (bboxGroup) =>
        bboxGroup.document_name === currentDocument &&
        parseInt(bboxGroup.page_number) === pageNumber
    );
  }, [boundingBoxes, currentDocument, pageNumber]);

  return (
    <div ref={containerRef} style={containerStyle}>
      <img
        ref={imageRef}
        src={imageUrl}
        alt={`Page ${pageNumber}`}
        style={imageStyle}
        onLoad={handleImageLoad}
        onError={handleImageError}
        onMouseDown={handleImageMouseDown}
        onMouseMove={handleImageMouseMove}
        onMouseUp={handleImageMouseUp}
        onMouseLeave={handleImageMouseLeave}
        draggable={false}
      />

      {imageLoaded && (
        <>
          {/* Glowing Cursor Ring - Show only for annotation toolbar mode */}
          {isAnnotationMode &&
            !isTransitioning &&
            mousePosition && (
              <div
                style={{
                  position: "absolute",
                  left: `${mousePosition.x - 20}px`,
                  top: `${mousePosition.y - 20}px`,
                  width: "40px",
                  height: "40px",
                  pointerEvents: "none",
                  zIndex: 30,
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    border: `2px solid ${
                      isAnnotationMode ? "#059669" : "#3b82f6"
                    }`,
                    backgroundColor: `${
                      isAnnotationMode
                        ? "rgba(5, 150, 105, 0.2)"
                        : "rgba(59, 130, 246, 0.2)"
                    }`,
                    boxShadow: `0 0 20px ${
                      isAnnotationMode
                        ? "rgba(5, 150, 105, 0.6)"
                        : "rgba(59, 130, 246, 0.6)"
                    }`,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      border: `1px solid ${
                        isAnnotationMode ? "#10b981" : "#60a5fa"
                      }`,
                      animation: "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
                    }}
                  />
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "8px",
                    height: "8px",
                    backgroundColor: isAnnotationMode ? "#059669" : "#2563eb",
                    borderRadius: "50%",
                  }}
                />
              </div>
            )}

          {/* NEW: Enhanced Existing Bounding Boxes with Delete Functionality and Selection Highlighting */}
          {currentPageExistingBboxes.map((bboxGroup) =>
            bboxGroup.bbox.map((bbox, bboxIndex) => {
              const bboxId = `existing-${bboxGroup.document_name}-${bboxGroup.page_number}-${bboxIndex}`;
              // Skip deleted bounding boxes
              if (deletedExistingBboxes.has(bboxId)) {
                return null;
              }

              const isSelected = selectedRegion === bboxId;

              return (
                <div
                  key={bboxId}
                  style={{
                    position: "absolute",
                    pointerEvents: "auto",
                    transition: "all 0.3s ease-in-out",
                    borderRadius: "12px",
                    // Enhanced styling for selection
                    boxShadow: isSelected
                      ? "0 0 20px rgba(234, 179, 8, 0.6), 0 0 40px rgba(234, 179, 8, 0.3)"
                      : "0 0 20px rgba(59, 130, 246, 0.6), 0 0 40px rgba(59, 130, 246, 0.3)",
                    animation: isSelected
                      ? "selectedPulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite"
                      : "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                    zIndex: isSelected ? 15 : 8,
                    cursor: "default",
                    ...getExistingBboxStyle(bbox),
                  }}
                  title={`${isSelected ? "SELECTED: " : ""}Saved bounding box ${
                    bboxIndex + 1
                  }`}
                >
                  {/* Selection indicator overlay */}
                  {isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        top: "-8px",
                        right: "-8px",
                        width: "24px",
                        height: "24px",
                        backgroundColor: "#eab308",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        fontSize: "12px",
                        fontWeight: "bold",
                        zIndex: 20,
                        boxShadow: "0 2px 8px rgba(234, 179, 8, 0.5)",
                      }}
                    >
                      ✓
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Search Results Highlights */}
          {searchResults &&
            searchResults.results &&
            searchResults.results.map((result, resultIndex) => {
              if (
                result.document_name === currentDocument &&
                parseInt(result.page_number) === pageNumber
              ) {
                return result.bbox.map((coordinates, coordIndex) => {
                  const [x1, y1, x2, y2, x3, y3, x4, y4] = coordinates;
                  const actualDimensions = {
                    width:
                      imageRef.current?.offsetWidth || imageDimensions.width,
                    height:
                      imageRef.current?.offsetHeight || imageDimensions.height,
                  };
                  const left =
                    Math.min(x1, x2, x3, x4) * actualDimensions.width;
                  const top =
                    Math.min(y1, y2, y3, y4) * actualDimensions.height;
                  const width =
                    (Math.max(x1, x2, x3, x4) - Math.min(x1, x2, x3, x4)) *
                    actualDimensions.width;
                  const height =
                    (Math.max(y1, y2, y3, y4) - Math.min(y1, y2, y3, y4)) *
                    actualDimensions.height;
                  const isCurrentMatch = resultIndex === currentSearchIndex;
                  return (
                    <div
                      key={`search-${resultIndex}-${coordIndex}`}
                      style={{
                        position: "absolute",
                        left: `${left}px`,
                        top: `${top}px`,
                        width: `${width}px`,
                        height: `${height}px`,
                        backgroundColor: isCurrentMatch
                          ? "rgba(255, 87, 34, 0.4)"
                          : "rgba(76, 175, 80, 0.3)",
                        border: isCurrentMatch
                          ? "2px solid rgba(255, 87, 34, 0.8)"
                          : "1px solid rgba(76, 175, 80, 0.6)",
                        borderRadius: "2px",
                        boxShadow: isCurrentMatch
                          ? "0 2px 8px rgba(255, 87, 34, 0.3)"
                          : "none",
                        zIndex: isCurrentMatch ? 10 : 5,
                        transition: "all 0.2s ease-in-out",
                        pointerEvents: "none",
                      }}
                      title={`Search result: "${result.text_snippet}" (Score: ${result.match_score})`}
                    />
                  );
                });
              }
              return null;
            })}

          {/* NEW: Drawn Bounding Box Annotations Overlay with Selection Highlighting */}
          {currentPageDrawnAnnotations.map((annotation, index) => {
            const isSelected = selectedRegion === annotation.id;

            return (
              <div
                key={annotation.id}
                style={{
                  position: "absolute",
                  borderRadius: "4px",
                  boxShadow: isSelected
                    ? "0 0 20px rgba(234, 179, 8, 0.6), 0 0 40px rgba(234, 179, 8, 0.3)"
                    : "0 0 20px rgba(5, 150, 105, 0.6), 0 0 40px rgba(5, 150, 105, 0.3)",
                  zIndex: isSelected ? 15 : 7,
                  pointerEvents: "auto",
                  transition: "all 0.3s ease-in-out",
                  cursor: "default",
                  animation: isSelected
                    ? "selectedPulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite"
                    : "none",
                  ...getDrawnAnnotationStyle(annotation),
                }}
                title={`${
                  isSelected ? "SELECTED: " : ""
                }New bounding box annotation`}
              >
                {/* Selection indicator overlay */}
                {isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-8px",
                      right: "-8px",
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#eab308",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontSize: "12px",
                      fontWeight: "bold",
                      zIndex: 20,
                      boxShadow: "0 2px 8px rgba(234, 179, 8, 0.5)",
                    }}
                  >
                    ✓
                  </div>
                )}
              </div>
            );
          })}

          {/* Active Bounding Box Selection Overlay */}
          {!isTransitioning &&
            isSelectingBBox &&
            selectionStartBBox &&
            selectionCurrentBBox && (
              <div
                style={{
                  position: "absolute",
                  left: `${Math.min(
                    selectionStartBBox.x,
                    selectionCurrentBBox.x
                  )}px`,
                  top: `${Math.min(
                    selectionStartBBox.y,
                    selectionCurrentBBox.y
                  )}px`,
                  width: `${Math.abs(
                    selectionCurrentBBox.x - selectionStartBBox.x
                  )}px`,
                  height: `${Math.abs(
                    selectionCurrentBBox.y - selectionStartBBox.y
                  )}px`,
                  border: "2px dashed #059669",
                  backgroundColor: "rgba(5, 150, 105, 0.2)",
                  pointerEvents: "none",
                  zIndex: 20,
                }}
              />
            )}

          <AnnotationCanvas
            width={imageDimensions.width}
            height={imageDimensions.height}
            zoom={zoom}
            annotationMode={annotationMode}
            currentPage={pageNumber}
            onAnnotationAdd={onAnnotationAdd}
          />
        </>
      )}

      {!imageLoaded && (
        <div style={loadingStyle}>
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: "8px" }}>
              {preloadedImages.has(imageUrl) ? "✓" : "⟳"}
            </div>
            <div style={{ color: "#666" }}>
              {preloadedImages.has(imageUrl)
                ? `Page ${pageNumber} ready`
                : `Loading page ${pageNumber}...`}
            </div>
          </div>
        </div>
      )}

      {/* Add CSS animations */}
      <style jsx>{`
        @keyframes ping {
          75%,
          100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        @keyframes selectedPulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.02);
          }
        }
      `}</style>
    </div>
  );
};
