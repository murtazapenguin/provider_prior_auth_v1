import { useEffect, useRef, useState } from "react";
import { getEntityColor, getLighterColor } from "../utils/colorUtils";

export const NERPDFPageRenderer = ({
  imageUrl,
  pageNumber,
  currentDocument,
  nerData,
  visibleEntityTypes,
  onEntityClick,
  preloadedImages = new Map(),
  isTransitioning = false,
  selectedEntity = null,
  showTagsSidebar = false,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({
    width: 0,
    height: 0,
  });
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const [forceUpdate, setForceUpdate] = useState(0);

  const handleImageLoad = () => {
    setImageLoaded(true);
    if (imageRef.current) {
      setImageDimensions({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
      // Force update to recalculate positions after image loads
      setTimeout(() => setForceUpdate((prev) => prev + 1), 100);
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

  // Force update when sidebar toggles to recalculate positions
  useEffect(() => {
    const timer = setTimeout(() => {
      setForceUpdate((prev) => prev + 1);
    }, 350); // Wait for sidebar transition to complete

    return () => clearTimeout(timer);
  }, [showTagsSidebar]);

  // Get NER entities for current page
  // Handle new data structure
  const documentData = nerData.find((doc) => doc.filename === currentDocument);
  const pageEntities = documentData?.data[pageNumber.toString()] || [];
  const visibleEntities = pageEntities.filter((entity) =>
    visibleEntityTypes.has(entity.entity_type)
  );

  // FIXED: Calculate highlight styles for NER entities with stable positioning
  const getEntityHighlightStyle = (entity) => {
    if (
      !imageRef.current ||
      !imageLoaded ||
      !imageDimensions.width ||
      !imageDimensions.height
    ) {
      return { display: "none" };
    }

    // Use natural image dimensions as the baseline for consistent positioning
    const naturalWidth = imageDimensions.width;
    const naturalHeight = imageDimensions.height;

    // Get current rendered dimensions
    const renderedWidth = imageRef.current.offsetWidth;
    const renderedHeight = imageRef.current.offsetHeight;

    if (renderedWidth === 0 || renderedHeight === 0) {
      return { display: "none" };
    }

    // Calculate scale factors based on how the image is currently displayed
    const scaleX = renderedWidth / naturalWidth;
    const scaleY = renderedHeight / naturalHeight;

    const [x_min, y_min, x_max, y_max] = entity.bbox;

    // Calculate position and dimensions using natural dimensions then scale to current size
    const left = x_min * naturalWidth * scaleX;
    const top = y_min * naturalHeight * scaleY;
    const width = (x_max - x_min) * naturalWidth * scaleX;
    const height = (y_max - y_min) * naturalHeight * scaleY;

    const color = getEntityColor(entity.entity_type);
    const isSelected =
      selectedEntity &&
      selectedEntity.word === entity.word &&
      selectedEntity.entity_type === entity.entity_type &&
      selectedEntity.bbox.join(",") === entity.bbox.join(",");

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${Math.max(height, 30)}px`, // Minimum height of 25px for visibility
      backgroundColor: getLighterColor(color, 0.2),
      border: `2px solid ${color}`,
      borderRadius: "3px",
      cursor: "pointer",
      transition: "all 0.2s ease-in-out",
      transform: isSelected ? "scale(1.02)" : "scale(1)",
      boxShadow: isSelected
        ? `0 4px 12px ${getLighterColor(color, 0.6)}`
        : `0 1px 3px ${getLighterColor(color, 0.4)}`,
      zIndex: isSelected ? 20 : 10,
    };
  };

  const handleEntityClick = (entity, event) => {
    event.stopPropagation();
    onEntityClick?.(entity);
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

  return (
    <div ref={containerRef} style={containerStyle}>
      <img
        ref={imageRef}
        src={imageUrl}
        alt={`Page ${pageNumber}`}
        style={imageStyle}
        onLoad={handleImageLoad}
        onError={handleImageError}
        draggable={false}
      />

      {imageLoaded && (
        <>
          {/* NER Entity Highlights */}
          {visibleEntities.map((entity, index) => {
            const highlightStyle = getEntityHighlightStyle(entity);

            // Only render if we have valid positioning
            if (
              highlightStyle.display === "none" ||
              !highlightStyle.left ||
              !highlightStyle.top
            ) {
              return null;
            }

            return (
              <div
                key={`${entity.word}-${entity.entity_type}-${entity.bbox.join(
                  ","
                )}-${index}-${forceUpdate}`}
                style={{
                  position: "absolute",
                  pointerEvents: isTransitioning ? "none" : "auto",
                  ...highlightStyle,
                }}
                onClick={(e) => handleEntityClick(entity, e)}
                title={`${entity.entity} (${entity.entity_type})\nCode: ${entity.code}\nWord: ${entity.word}`}
              >
                {/* Entity Label */}
                <div
                  style={{
                    position: "absolute",
                    top: "-26px",
                    left: "0",
                    backgroundColor: getEntityColor(entity.entity_type),
                    color: "white",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: "600",
                    whiteSpace: "nowrap",
                    textTransform: "capitalize",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                    opacity: 0,
                    transition: "opacity 0.2s ease-in-out",
                    pointerEvents: "none",
                    zIndex: 25,
                  }}
                  className="entity-label"
                >
                  {entity.entity_type.replace(/_/g, " ")}
                </div>
              </div>
            );
          })}
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

      {/* CSS for hover effects */}
      <style jsx>{`
        div:hover .entity-label {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
};
