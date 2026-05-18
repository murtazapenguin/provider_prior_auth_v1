import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getEntityColor,
  getLighterColor,
  getUniqueEntityTypes,
} from "../utils/colorUtils";
import { NEREntityDetails } from "./NEREntityDetails";
import { NERPDFPageRenderer } from "./NERPDFPageRenderer";
import { NERTagsSidebar } from "./NERTagsSidebar";
import { PDFToolbar } from "./PDFToolbar";

export const NERViewer = ({
  documentData,
  nerData,
  onDocumentChange,
  onPageChange,
  className = "",
  userInterfaces = {
    docNavigation: true,
    zoom: true,
    download: false,
    keyboardShortcuts: true,
    showFilename: true,
  },
}) => {
  const [currentFile, setCurrentFile] = useState(documentData.files[0]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [visiblePageInCenter, setVisiblePageInCenter] = useState(1);

  // NER-specific state
  const [visibleEntityTypes, setVisibleEntityTypes] = useState(new Set());
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [showTagsSidebar, setShowTagsSidebar] = useState(false);

  // Loading states
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [preloadedImages, setPreloadedImages] = useState(new Map());
  const [preloadingProgress, setPreloadingProgress] = useState(0);
  const [isPreloading, setIsPreloading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Scroll and navigation refs
  const contentRef = useRef(null);
  const pageRefs = useRef({});
  const observerRef = useRef(null);
  const scrollAnimationRef = useRef(null);
  const keyboardIntervalRef = useRef(null);
  const keyboardTimeoutRef = useRef(null);
  const scrollToPageTimeoutRef = useRef(null);

  // Keyboard state management
  const [pressedKeys, setPressedKeys] = useState(new Set());
  // const [isKeyboardActive, setIsKeyboardActive] = useState(false);
  // const [isScrolling, setIsScrolling] = useState(false);
  const pressedKeysRef = useRef(new Set());

  // Memoize currentFilePages to prevent unnecessary re-renders
  const currentFilePages = useMemo(() => {
    return documentData.presigned_urls[currentFile] || {};
  }, [documentData.presigned_urls, currentFile]);

  const totalPages = Object.keys(currentFilePages).length;
  const pageNumbers = Object.keys(currentFilePages)
    .map(Number)
    .sort((a, b) => a - b);

  // Initialize visible entity types
  useEffect(() => {
    const entityTypes = getUniqueEntityTypes(nerData);
    setVisibleEntityTypes(new Set(entityTypes));
  }, [nerData]);

  // Get current page entities for count
  const getCurrentPageEntities = () => {
    // Handle new data structure
    const documentData = nerData.find((doc) => doc.filename === currentFile);
    return documentData?.data[visiblePageInCenter.toString()] || [];
  };

  // Get entity type counts for current page
  const getEntityTypeCounts = () => {
    const entities = getCurrentPageEntities();
    const counts = {};
    entities.forEach((entity) => {
      counts[entity.entity_type] = (counts[entity.entity_type] || 0) + 1;
    });
    return counts;
  };

  // Image preloading function
  const preloadImages = useCallback(async () => {
    if (!documentData || !documentData.presigned_urls) return;

    setIsPreloading(true);
    const imageMap = new Map();
    const allUrls = [];

    Object.entries(documentData.presigned_urls).forEach(([fileName, pages]) => {
      Object.entries(pages).forEach(([pageNumber, url]) => {
        allUrls.push({ fileName, pageNumber, url });
      });
    });

    const totalImages = allUrls.length;
    let loadedCount = 0;

    const loadPromises = allUrls.map(({ fileName, pageNumber, url }) => {
      return new Promise((resolve) => {
        const img = new Image();

        img.onload = () => {
          imageMap.set(url, img);
          loadedCount++;
          setPreloadingProgress((loadedCount / totalImages) * 100);
          resolve();
        };

        img.onerror = () => {
          console.warn(
            `Failed to preload image: ${fileName} page ${pageNumber}`
          );
          loadedCount++;
          setPreloadingProgress((loadedCount / totalImages) * 100);
          resolve();
        };

        img.src = url;
      });
    });

    try {
      await Promise.all(loadPromises);
      setPreloadedImages(imageMap);
      console.log(`Successfully preloaded ${imageMap.size} images`);
    } catch (error) {
      console.error("Error during image preloading:", error);
    } finally {
      setIsPreloading(false);
    }
  }, [documentData]);

  // Enhanced smooth scroll function with easing
  const smoothScrollTo = useCallback((targetScroll, duration = 300) => {
    if (!contentRef.current) return;

    const container = contentRef.current;
    const startScroll = container.scrollTop;
    const distance = targetScroll - startScroll;

    if (Math.abs(distance) < 5) {
      container.scrollTop = targetScroll;
      // setIsScrolling(false);
      return;
    }

    const startTime = performance.now();

    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
    }

    const animateScroll = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out-cubic
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);

      container.scrollTop = startScroll + distance * easeOutCubic;

      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(animateScroll);
      } else {
        scrollAnimationRef.current = null;
        // setIsScrolling(false);
      }
    };

    // setIsScrolling(true);
    scrollAnimationRef.current = requestAnimationFrame(animateScroll);
  }, []);

  // Direct scroll function for continuous keyboard scrolling
  const directScroll = useCallback((scrollAmount) => {
    if (!contentRef.current) return;

    const container = contentRef.current;
    const targetScroll = Math.max(
      0,
      Math.min(
        container.scrollHeight - container.clientHeight,
        container.scrollTop + scrollAmount
      )
    );

    container.scrollTop = targetScroll;
  }, []);

  // Scroll to specific page function
  const scrollToPage = useCallback(
    (pageNumber) => {
      if (!contentRef.current || !pageRefs.current[pageNumber]) return;

      const container = contentRef.current;
      const pageElement = pageRefs.current[pageNumber];

      if (scrollToPageTimeoutRef.current) {
        clearTimeout(scrollToPageTimeoutRef.current);
      }

      const containerRect = container.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();

      const containerCenter = containerRect.height / 2;
      const pageCenter = pageRect.height / 2;
      const targetOffset =
        pageRect.top - containerRect.top - containerCenter + pageCenter;

      const targetScroll = container.scrollTop + targetOffset;

      smoothScrollTo(targetScroll, 800);

      scrollToPageTimeoutRef.current = setTimeout(() => {
        setVisiblePageInCenter(pageNumber);
        setCurrentPage(pageNumber);
        onPageChange?.(pageNumber);
      }, 850);
    },
    [smoothScrollTo, onPageChange]
  );

  // Set up intersection observer to track visible page
  useEffect(() => {
    if (!contentRef.current) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let mostVisiblePage = visiblePageInCenter;
        let highestRatio = 0;

        entries.forEach((entry) => {
          if (
            entry.isIntersecting &&
            entry.intersectionRatio > highestRatio &&
            entry.intersectionRatio >= 0.3
          ) {
            const pageElement = entry.target;
            const pageNumber = parseInt(pageElement.dataset.pageNumber || "1");
            if (!isNaN(pageNumber)) {
              mostVisiblePage = pageNumber;
              highestRatio = entry.intersectionRatio;
            }
          }
        });

        if (mostVisiblePage !== visiblePageInCenter) {
          setVisiblePageInCenter(mostVisiblePage);
          setCurrentPage(mostVisiblePage);
          onPageChange?.(mostVisiblePage);
        }
      },
      {
        root: contentRef.current,
        rootMargin: "-20% 0px -20% 0px",
        threshold: [0.1, 0.3, 0.5, 0.7, 0.9],
      }
    );

    // Observe all page elements
    Object.values(pageRefs.current).forEach((pageElement) => {
      if (pageElement) {
        observer.observe(pageElement);
      }
    });

    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [currentFile, visiblePageInCenter, onPageChange]);

  // Handle initial loading and start preloading
  useEffect(() => {
    const initTimer = setTimeout(() => {
      setIsInitialLoading(false);
    }, 1000);

    preloadImages();

    return () => clearTimeout(initTimer);
  }, [preloadImages]);

  // Enhanced keyboard navigation
  useEffect(() => {
    pressedKeysRef.current = pressedKeys;
  }, [pressedKeys]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.closest('[role="dialog"]') ||
          activeElement.closest(".modal"))
      ) {
        return;
      }

      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(
          e.key
        )
      ) {
        e.preventDefault();

        if (isTransitioning) return;

        const wasAlreadyPressed = pressedKeysRef.current.has(e.key);

        setPressedKeys((prev) => new Set([...prev, e.key]));
        pressedKeysRef.current.add(e.key);

        if (!wasAlreadyPressed) {
          handleInitialKeyPress(e);
          startContinuousScrolling(e.key);
        }
      }
    };

    const handleKeyUp = (e) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(
          e.key
        )
      ) {
        setPressedKeys((prev) => {
          const newSet = new Set(prev);
          newSet.delete(e.key);
          pressedKeysRef.current.delete(e.key);

          if (newSet.size === 0) {
            stopContinuousScrolling();
            // setIsKeyboardActive(false);
          }

          return newSet;
        });
      }
    };

    const handleInitialKeyPress = (e) => {
      if (!contentRef.current) return;

      // setIsKeyboardActive(true);

      const container = contentRef.current;
      const containerHeight = container.clientHeight;

      let scrollAmount;

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (e.ctrlKey || e.metaKey) {
          scrollAmount =
            e.key === "ArrowUp"
              ? -container.scrollHeight
              : container.scrollHeight;
        } else if (e.shiftKey) {
          scrollAmount =
            e.key === "ArrowUp"
              ? -containerHeight * 0.8
              : containerHeight * 0.8;
        } else {
          scrollAmount = e.key === "ArrowUp" ? -150 : 150;
        }
      } else if (e.key === "PageUp" || e.key === "PageDown") {
        scrollAmount =
          e.key === "PageUp" ? -containerHeight * 0.9 : containerHeight * 0.9;
      } else if (e.key === "Home" || e.key === "End") {
        scrollAmount =
          e.key === "Home" ? -container.scrollHeight : container.scrollHeight;
      } else {
        return;
      }

      const targetScroll = Math.max(
        0,
        Math.min(
          container.scrollHeight - container.clientHeight,
          container.scrollTop + scrollAmount
        )
      );

      if (e.ctrlKey || e.metaKey || e.key === "Home" || e.key === "End") {
        smoothScrollTo(targetScroll, 800);
      } else if (e.shiftKey || e.key === "PageUp" || e.key === "PageDown") {
        smoothScrollTo(targetScroll, 500);
      } else {
        smoothScrollTo(targetScroll, 300);
      }
    };

    const startContinuousScrolling = (key) => {
      stopContinuousScrolling();

      keyboardTimeoutRef.current = setTimeout(() => {
        keyboardIntervalRef.current = setInterval(() => {
          if (pressedKeysRef.current.has(key) && contentRef.current) {
            let scrollAmount;

            if (key === "ArrowUp") {
              scrollAmount = -80;
            } else if (key === "ArrowDown") {
              scrollAmount = 80;
            } else if (key === "PageUp") {
              scrollAmount = -300;
            } else if (key === "PageDown") {
              scrollAmount = 300;
            } else {
              return;
            }

            directScroll(scrollAmount);
          } else {
            stopContinuousScrolling();
          }
        }, 50);
      }, 300);
    };

    const stopContinuousScrolling = () => {
      if (keyboardIntervalRef.current) {
        clearInterval(keyboardIntervalRef.current);
        keyboardIntervalRef.current = null;
      }
      if (keyboardTimeoutRef.current) {
        clearTimeout(keyboardTimeoutRef.current);
        keyboardTimeoutRef.current = null;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      stopContinuousScrolling();
      pressedKeysRef.current.clear();
    };
  }, [isTransitioning, smoothScrollTo, directScroll]);

  // Enhanced mouse wheel handler
  useEffect(() => {
    const handleWheel = (e) => {
      if (!contentRef.current || isTransitioning) return;

      e.preventDefault();

      const container = contentRef.current;
      let scrollAmount = e.deltaY;

      if (e.deltaMode === 0) {
        scrollAmount = e.deltaY * 0.8;
      } else {
        scrollAmount = e.deltaY * 40;
      }

      const targetScroll = Math.max(
        0,
        Math.min(
          container.scrollHeight - container.clientHeight,
          container.scrollTop + scrollAmount
        )
      );

      container.scrollTop = targetScroll;
    };

    const container = contentRef.current;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false });

      return () => {
        container.removeEventListener("wheel", handleWheel);
      };
    }
  }, [isTransitioning]);

  const handleFileChange = useCallback(
    (file, targetPage = 1) => {
      setIsTransitioning(true);
      setCurrentFile(file);
      setSelectedEntity(null); // Clear selected entity when changing files

      setTimeout(() => {
        setCurrentPage(targetPage);
        setVisiblePageInCenter(targetPage);
        onDocumentChange?.(file);

        setTimeout(() => {
          scrollToPage(targetPage);
          setIsTransitioning(false);
        }, 100);
      }, 100);
    },
    [onDocumentChange, scrollToPage]
  );

  const handlePageChange = useCallback(
    (page) => {
      if (page >= 1 && page <= totalPages) {
        scrollToPage(page);
        setSelectedEntity(null); // Clear selected entity when changing pages
      }
    },
    [totalPages, scrollToPage]
  );

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.25, 0.25));
  }, []);

  const handleDownload = useCallback(async () => {
    const currentPageUrl = currentFilePages[currentPage.toString()];
    if (currentPageUrl) {
      try {
        const response = await fetch(currentPageUrl, {
          mode: "cors",
          credentials: "omit",
        });

        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${currentFile.replace(
            /\.[^/.]+$/,
            ""
          )}_page_${currentPage}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.log("Fetch download failed, trying direct download:", error);
        const link = document.createElement("a");
        link.href = currentPageUrl;
        link.download = `${currentFile.replace(
          /\.[^/.]+$/,
          ""
        )}_page_${currentPage}.png`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  }, [currentFile, currentPage, currentFilePages]);

  // NER-specific handlers
  const handleEntityTypeToggle = useCallback((entityType, isVisible) => {
    setVisibleEntityTypes((prev) => {
      const newSet = new Set(prev);
      if (isVisible) {
        newSet.add(entityType);
      } else {
        newSet.delete(entityType);
      }
      return newSet;
    });
  }, []);

  const handleEntityClick = useCallback((entity) => {
    setSelectedEntity(entity);
  }, []);

  const handleToggleTagsSidebar = useCallback(() => {
    setShowTagsSidebar((prev) => !prev);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "=":
          case "+":
            e.preventDefault();
            handleZoomIn();
            break;
          case "-":
            e.preventDefault();
            handleZoomOut();
            break;
        }
      } else {
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            handlePageChange(currentPage - 1);
            break;
          case "ArrowRight":
            e.preventDefault();
            handlePageChange(currentPage + 1);
            break;
          case "Escape":
            setSelectedEntity(null);
            break;
          case "t":
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              handleToggleTagsSidebar();
            }
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentPage,
    handlePageChange,
    handleZoomIn,
    handleZoomOut,
    handleToggleTagsSidebar,
  ]);

  // Cleanup animation frames and intervals on unmount
  useEffect(() => {
    return () => {
      if (scrollAnimationRef.current) {
        cancelAnimationFrame(scrollAnimationRef.current);
      }
      if (keyboardIntervalRef.current) {
        clearInterval(keyboardIntervalRef.current);
      }
      if (keyboardTimeoutRef.current) {
        clearTimeout(keyboardTimeoutRef.current);
      }
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (scrollToPageTimeoutRef.current) {
        clearTimeout(scrollToPageTimeoutRef.current);
      }
    };
  }, []);

  const containerStyle = {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const mainContentStyle = {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  };

  const contentStyle = {
    flex: 1,
    overflow: "hidden",
    position: "relative",
    background: "#f8f9fa",
  };

  const statusBarStyle = {
    backgroundColor: "white",
    borderTop: "1px solid #e0e0e0",
    padding: "12px 20px",
    position: "relative",
    zIndex: 10,
    flexShrink: 0,
  };

  const statusContentStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "14px",
    color: "#666",
    marginBottom: "12px",
  };

  const initialLoadingStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    flexDirection: "column",
    gap: "20px",
  };

  const spinnerStyle = {
    width: "40px",
    height: "40px",
    border: "4px solid #e0e0e0",
    borderTop: "4px solid #1976d2",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  };

  const progressBarStyle = {
    width: "300px",
    height: "6px",
    backgroundColor: "#e0e0e0",
    borderRadius: "3px",
    overflow: "hidden",
  };

  const progressFillStyle = {
    height: "100%",
    backgroundColor: "#1976d2",
    borderRadius: "3px",
    transition: "width 0.3s ease",
    width: `${preloadingProgress}%`,
  };

  const formatFileName = (fileName) => {
    const parts = fileName.split(".");
    if (parts.length > 1) {
      return parts.slice(0, -1).join(".");
    }
    return fileName;
  };

  // Show initial loading overlay with preloading progress
  if (isInitialLoading || isPreloading) {
    return (
      <div
        style={{ ...containerStyle, position: "relative" }}
        className={className}
      >
        <div style={initialLoadingStyle}>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>
          <div style={spinnerStyle}></div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: "18px",
                color: "#333",
                fontWeight: "600",
                marginBottom: "8px",
              }}
            >
              Loading NER Viewer...
            </div>
            {isPreloading && (
              <>
                <div
                  style={{
                    fontSize: "14px",
                    color: "#666",
                    marginBottom: "12px",
                  }}
                >
                  Preloading images: {Math.round(preloadingProgress)}%
                </div>
                <div style={progressBarStyle}>
                  <div style={progressFillStyle}></div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const entityTypeCounts = getEntityTypeCounts();
  const allEntityTypes = getUniqueEntityTypes(nerData);
  const currentPageEntities = getCurrentPageEntities();

  return (
    <div style={containerStyle} className={className}>
      {/* Toolbar */}
      <div style={{ position: "relative", zIndex: 10, flexShrink: 0 }}>
        <PDFToolbar
          files={documentData.files}
          currentFile={currentFile}
          currentPage={visiblePageInCenter}
          totalPages={totalPages}
          zoom={zoom}
          onFileChange={handleFileChange}
          onPageChange={handlePageChange}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onDownload={handleDownload}
          documentData={documentData}
          userInterfaces={userInterfaces}
          // Disable search for NER viewer
          searchQuery=""
          searchResults={null}
          currentSearchIndex={-1}
          onSearchChange={() => {}}
          onSearchSubmit={() => {}}
          onSearchNavigate={() => {}}
          onSearchClear={() => {}}
          isSearchLoading={false}
        />
      </div>

      {/* Main Content Area - No Sidebar */}
      <div style={mainContentStyle}>
        {/* PDF Content Area */}
        <div style={contentStyle}>
          {/* Entity Details Popup */}
          {selectedEntity && (
            <div
              style={{
                position: "absolute",
                top: "20px",
                right: showTagsSidebar ? "420px" : "20px",
                zIndex: 30,
                maxWidth: "350px",
                transition: "right 0.3s ease",
              }}
            >
              <NEREntityDetails
                entity={selectedEntity}
                onClose={() => setSelectedEntity(null)}
                currentDocument={currentFile}
                currentPage={visiblePageInCenter}
              />
            </div>
          )}

          {/* Corner Elements */}
          {/* Filename indicator - Only show if enabled */}
          {userInterfaces?.showFilename && (
            <div
              style={{
                position: "absolute",
                top: "16px",
                left: "16px",
                zIndex: 10,
              }}
            >
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.9)",
                  backdropFilter: "blur(8px)",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                  border: "1px solid #e5e7eb",
                  transition: "all 0.3s ease",
                  opacity: isTransitioning ? 0.5 : 1,
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: "500",
                    color: "#374151",
                  }}
                >
                  {formatFileName(currentFile)}
                </span>
              </div>
            </div>
          )}

          <div
            style={{
              position: "absolute",
              top: "16px",
              right: showTagsSidebar
                ? selectedEntity
                  ? "790px"
                  : "420px"
                : selectedEntity
                ? "390px"
                : "16px",
              zIndex: 10,
              transition: "right 0.3s ease",
            }}
          >
            <div
              style={{
                background: "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(8px)",
                padding: "8px 12px",
                borderRadius: "8px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                border: "1px solid #e5e7eb",
                transition: "all 0.3s ease",
                opacity: isTransitioning ? 0.5 : 1,
              }}
            >
              <span style={{ fontSize: "14px", color: "#6b7280" }}>Pg</span>
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#dc2626",
                  marginLeft: "4px",
                }}
              >
                {visiblePageInCenter}
              </span>
              <span
                style={{
                  fontSize: "14px",
                  color: "#6b7280",
                  marginLeft: "4px",
                }}
              >
                of {totalPages}
              </span>
            </div>
          </div>

          {/* Loading indicator */}
          {!preloadedImages.size && (
            <div
              style={{
                position: "absolute",
                top: "64px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 20,
              }}
            >
              <div
                style={{
                  background: "#2563eb",
                  color: "white",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
                  border: "1px solid #1d4ed8",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      border: "2px solid white",
                      borderTop: "2px solid transparent",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                    }}
                  ></div>
                  <span style={{ fontSize: "14px", fontWeight: "bold" }}>
                    Loading images for smooth scrolling...
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Keyboard shortcuts indicator - Only show if enabled */}
          {userInterfaces?.keyboardShortcuts && (
            <div
              style={{
                position: "absolute",
                bottom: "16px",
                right: showTagsSidebar ? "420px" : "16px",
                zIndex: 10,
                transition: "right 0.3s ease",
              }}
            >
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.7)",
                  color: "white",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              >
                <div style={{ marginBottom: "4px" }}>
                  ↑↓ Scroll • Shift+↑↓ Page • Ctrl+↑↓ Top/Bottom
                </div>
                <div style={{ marginBottom: "4px" }}>
                  PgUp/PgDn Page • Home/End Document
                </div>
                <div style={{ marginBottom: "4px" }}>
                  Ctrl+T Toggle Tags Sidebar
                </div>
                <div style={{ color: "#fbbf24" }}>
                  Click entities to view details
                </div>
              </div>
            </div>
          )}

          {/* Scrollable PDF Container */}
          <div
            ref={contentRef}
            style={{
              height: "100%",
              overflowY: "auto",
              overflowX: "hidden",
              scrollBehavior: "auto",
              scrollbarWidth: "thin",
              scrollbarColor: "#cbd5e1 #f1f5f9",
              position: "relative",
            }}
          >
            {/* All Pages Container */}
            <div
              style={{
                minHeight: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "32px 16px",
                gap: "24px",
              }}
            >
              {pageNumbers.map((pageNumber) => {
                const pageUrl = currentFilePages[pageNumber.toString()];
                if (!pageUrl) return null;

                return (
                  <div
                    key={pageNumber}
                    ref={(el) => {
                      if (el) {
                        pageRefs.current[pageNumber] = el;
                        el.dataset.pageNumber = pageNumber.toString();
                      }
                    }}
                    style={{
                      background: "white",
                      // boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      borderRadius: "12px",
                      overflow: "hidden",
                      transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                      opacity: isTransitioning ? 0.3 : 1,
                      filter: isTransitioning ? "blur(2px)" : "none",
                      transform: `scale(${isTransitioning ? 0.95 : 1})`,
                      outline:
                        pageNumber === visiblePageInCenter
                          ? "2px solid #3b82f6"
                          : "none",
                      outlineOffset:
                        pageNumber === visiblePageInCenter ? "4px" : "0",
                      boxShadow:
                        pageNumber === visiblePageInCenter
                          ? "0 8px 24px rgba(59, 130, 246, 0.2)"
                          : "0 4px 12px rgba(0,0,0,0.15)",
                      maxWidth: "100%",
                      width: "fit-content",
                      position: "relative",
                    }}
                  >
                    {/* Page Number Badge */}
                    <div
                      style={{
                        position: "absolute",
                        top: "12px",
                        left: "12px",
                        zIndex: 10,
                      }}
                    >
                      <div
                        style={{
                          padding: "6px 12px",
                          borderRadius: "20px",
                          fontSize: "12px",
                          fontWeight: "bold",
                          transition: "all 0.3s ease",
                          background:
                            pageNumber === visiblePageInCenter
                              ? "#2563eb"
                              : "#1f2937",
                          color: "white",
                          boxShadow:
                            pageNumber === visiblePageInCenter
                              ? "0 4px 12px rgba(37, 99, 235, 0.4)"
                              : "0 2px 8px rgba(0,0,0,0.3)",
                          outline:
                            pageNumber === visiblePageInCenter
                              ? "2px solid #93c5fd"
                              : "none",
                        }}
                      >
                        Page {pageNumber}
                      </div>
                    </div>

                    {/* Page Content */}
                    <div
                      style={{
                        position: "relative",
                        display: "inline-block",
                        transform: `scale(${zoom})`,
                        transformOrigin: "center center",
                      }}
                    >
                      <NERPDFPageRenderer
                        imageUrl={pageUrl}
                        pageNumber={pageNumber}
                        zoom={1}
                        currentDocument={currentFile}
                        nerData={nerData}
                        visibleEntityTypes={visibleEntityTypes}
                        onEntityClick={handleEntityClick}
                        preloadedImages={preloadedImages}
                        isTransitioning={isTransitioning}
                        selectedEntity={selectedEntity}
                        showTagsSidebar={showTagsSidebar}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Spacer for better scrolling */}
              <div style={{ height: "128px" }}></div>
            </div>
          </div>
        </div>

        {/* Tags Sidebar */}
        <NERTagsSidebar
          nerData={nerData}
          currentDocument={currentFile}
          currentPage={visiblePageInCenter}
          visibleEntityTypes={visibleEntityTypes}
          onEntityTypeToggle={handleEntityTypeToggle}
          isVisible={showTagsSidebar}
          onToggle={handleToggleTagsSidebar}
        />
      </div>

      {/* Enhanced Status Bar with Beautiful Entity Type Labels */}
      <div style={statusBarStyle}>
        <div style={statusContentStyle}>
          <span>
            {currentFile} • Page {visiblePageInCenter} of {totalPages} •{" "}
            {Math.round(zoom * 100)}% zoom
            {preloadedImages.size > 0 && (
              <> • {preloadedImages.size} images preloaded</>
            )}
          </span>
          <span>
            <strong>{currentPageEntities.length}</strong> entities on this page
          </span>
        </div>

        {/* Beautiful Entity Type Labels */}
        {allEntityTypes.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              alignItems: "center",
              paddingTop: "8px",
              borderTop: "1px solid #e5e7eb",
              marginBottom: "40px",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                color: "#6b7280",
                fontWeight: "600",
                marginRight: "8px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full"></div>
              Entity Types:
            </span>
            {allEntityTypes.map((entityType) => {
              const count = entityTypeCounts[entityType] || 0;
              const color = getEntityColor(entityType);
              const isVisible = visibleEntityTypes.has(entityType);
              const hasEntitiesOnPage = count > 0;

              return (
                <button
                  key={entityType}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleEntityTypeToggle(entityType, !isVisible);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "16px",
                    fontSize: "12px",
                    fontWeight: "600",
                    border: "2px solid",
                    borderColor: isVisible ? color : "#d1d5db",
                    backgroundColor: isVisible
                      ? getLighterColor(color, 0.15)
                      : "#f9fafb",
                    color: isVisible ? color : "#6b7280",
                    cursor: "pointer",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    opacity: hasEntitiesOnPage ? 1 : 0.7,
                    transform: isVisible
                      ? hasEntitiesOnPage
                        ? "scale(1.02)"
                        : "scale(1)"
                      : "scale(0.98)",
                    boxShadow:
                      isVisible && hasEntitiesOnPage
                        ? `0 4px 12px ${getLighterColor(color, 0.3)}`
                        : "0 1px 3px rgba(0,0,0,0.1)",
                  }}
                  title={`${entityType.replace(/_/g, " ")} - Click to ${
                    isVisible ? "hide" : "show"
                  }${hasEntitiesOnPage ? ` (${count} on current page)` : ""}`}
                  onMouseEnter={(e) => {
                    if (isVisible && hasEntitiesOnPage) {
                      e.target.style.transform = "scale(1.05)";
                      e.target.style.boxShadow = `0 6px 16px ${getLighterColor(
                        color,
                        0.4
                      )}`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isVisible && hasEntitiesOnPage) {
                      e.target.style.transform = "scale(1.02)";
                      e.target.style.boxShadow = `0 4px 12px ${getLighterColor(
                        color,
                        0.3
                      )}`;
                    }
                  }}
                >
                  <div
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      backgroundColor: isVisible ? color : "#d1d5db",
                      boxShadow: isVisible
                        ? `0 0 0 2px ${getLighterColor(color, 0.3)}`
                        : "none",
                      transition: "all 0.2s ease",
                    }}
                  />
                  <span style={{ textTransform: "capitalize" }}>
                    {entityType.replace(/_/g, " ")}
                  </span>
                  {hasEntitiesOnPage && (
                    <div
                      style={{
                        backgroundColor: isVisible ? color : "#9ca3af",
                        color: "white",
                        borderRadius: "10px",
                        padding: "2px 6px",
                        fontSize: "10px",
                        fontWeight: "bold",
                        minWidth: "16px",
                        textAlign: "center",
                        lineHeight: "1.2",
                        boxShadow: isVisible
                          ? "0 2px 4px rgba(0,0,0,0.2)"
                          : "none",
                      }}
                    >
                      {count}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Add CSS animations */}
      <style jsx>{`
        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        .w-2 {
          width: 0.5rem;
        }
        .h-2 {
          height: 0.5rem;
        }
        .bg-gradient-to-r {
          background-image: linear-gradient(to right, var(--tw-gradient-stops));
        }
        .from-blue-500 {
          --tw-gradient-from: #3b82f6;
          --tw-gradient-stops: var(--tw-gradient-from),
            var(--tw-gradient-to, rgb(59 130 246 / 0));
        }
        .to-purple-600 {
          --tw-gradient-to: #9333ea;
        }
        .rounded-full {
          border-radius: 9999px;
        }
      `}</style>
    </div>
  );
};
