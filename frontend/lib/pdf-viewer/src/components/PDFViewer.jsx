import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationToolbar } from "./AnnotationToolbar";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { PDFPageRenderer } from "./PDFPageRenderer";
import { PDFToolbar } from "./PDFToolbar";

export const PDFViewer = ({
  documentData,
  boundingBoxes = null,
  searchResults = null,
  onDocumentChange,
  onPageChange,
  onAnnotationAdd,
  onSearchPerformed,
  className = "",
  setSearchResults,
  userInterfaces,
  initialPage = null,
}) => {

  const [currentFile, setCurrentFile] = useState(documentData.files[0]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pageRotations, setPageRotations] = useState({});
  const [annotationMode, setAnnotationMode] = useState("none");
  const [visiblePageInCenter, setVisiblePageInCenter] = useState(1);
  const [selectedRegion, setSelectedRegion] = useState(null);

  // Enhanced annotation state
  const [drawnAnnotations, setDrawnAnnotations] = useState([]);
  const [annotationHistoryStack, setAnnotationHistoryStack] = useState([[]]);
  const [annotationHistoryIndex, setAnnotationHistoryIndex] = useState(0);
  const [savedAnnotations, setSavedAnnotations] = useState([]);

  // Track deleted existing bounding boxes
  const [deletedExistingBboxes, setDeletedExistingBboxes] = useState(new Set());
  const [existingBboxHistory, setExistingBboxHistory] = useState([new Set()]);
  const [existingBboxHistoryIndex, setExistingBboxHistoryIndex] = useState(0);

  // Dialog state management
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    onConfirm: null,
    severity: "warning",
  });

  // Unsaved changes warning state
  const [unsavedChangesDialog, setUnsavedChangesDialog] = useState({
    open: false,
    pendingAction: null,
  });

  // Loading states
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [preloadedImages, setPreloadedImages] = useState(new Map());
  const [preloadingProgress, setPreloadingProgress] = useState(0);
  const [isPreloading, setIsPreloading] = useState(false);
  const [hasCompletedInitialPreload, setHasCompletedInitialPreload] =
    useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const [showNoResults, setShowNoResults] = useState(false);

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
  const pressedKeysRef = useRef(new Set());

  // Navigation tracking flags
  const hasAutoNavigatedRef = useRef(false);
  const isManualNavigationRef = useRef(false);
  const scrollUpdateTimeoutRef = useRef(null);
  const appliedInitialPageRef = useRef(null);

  // FIXED: Use ref instead of function property for preload tracking
  const lastPreloadKeyRef = useRef(null);

  // Track if this is a sidebar instance
  const isSidebarMode = useMemo(() => {
    return (
      userInterfaces?.enableToolbar === false &&
      userInterfaces?.zoom === true &&
      userInterfaces?.download === false
    );
  }, [userInterfaces]);

  // Reset auto-navigation whenever the active file or bounding boxes change,
  // so we re-jump to the page containing the first bbox on open.
  useEffect(() => {
    hasAutoNavigatedRef.current = false;
  }, [currentFile, documentData.files, boundingBoxes]);

  const currentFilePages = useMemo(() => {
    return documentData.presigned_urls[currentFile] || {};
  }, [documentData.presigned_urls, currentFile]);

  const totalPages = Object.keys(currentFilePages).length;
  const pageNumbers = Object.keys(currentFilePages)
    .map(Number)
    .sort((a, b) => a - b);

  // Get existing bounding boxes for current page
  const getCurrentPageExistingBboxes = useMemo(() => {
    if (!boundingBoxes || !Array.isArray(boundingBoxes)) return [];

    return boundingBoxes.filter(
      (bboxGroup) =>
        bboxGroup.document_name === currentFile &&
        parseInt(bboxGroup.page_number) === currentPage
    );
  }, [boundingBoxes, currentFile, currentPage]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    return drawnAnnotations.length > 0;
  }, [drawnAnnotations]);

  // Control annotation toolbar visibility
  const isAnnotationToolbarEnabled = useMemo(() => {
    return userInterfaces?.enableToolbar === true;
  }, [userInterfaces?.enableToolbar]);

  // Get total annotation count
  const getTotalAnnotationCount = useCallback(() => {
    let existingCount = 0;

    if (boundingBoxes && Array.isArray(boundingBoxes)) {
      boundingBoxes.forEach((bboxGroup) => {
        if (bboxGroup.document_name === currentFile) {
          bboxGroup.bbox.forEach((_, index) => {
            const bboxId = `existing-${bboxGroup.document_name}-${bboxGroup.page_number}-${index}`;
            if (!deletedExistingBboxes.has(bboxId)) {
              existingCount++;
            }
          });
        }
      });
    }

    const drawnCount = drawnAnnotations.filter(
      (ann) => ann.document_name === currentFile
    ).length;

    return existingCount + drawnCount;
  }, [boundingBoxes, deletedExistingBboxes, drawnAnnotations, currentFile]);

  // Check for unsaved changes and show warning
  const checkUnsavedChanges = useCallback(
    (pendingAction) => {
      if (hasUnsavedChanges) {
        setUnsavedChangesDialog({
          open: true,
          pendingAction: pendingAction,
        });
        return true;
      }
      return false;
    },
    [hasUnsavedChanges]
  );

  // Perform save
  const performSave = useCallback(() => {
    if (!isAnnotationToolbarEnabled) return;

    const savedData = [];

    if (boundingBoxes && Array.isArray(boundingBoxes)) {
      boundingBoxes.forEach((bboxGroup) => {
        const remainingBboxes = bboxGroup.bbox.filter((_, index) => {
          const bboxId = `existing-${bboxGroup.document_name}-${bboxGroup.page_number}-${index}`;
          return !deletedExistingBboxes.has(bboxId);
        });

        if (remainingBboxes.length > 0) {
          savedData.push({
            page_number: bboxGroup.page_number,
            document_name: bboxGroup.document_name,
            bbox: remainingBboxes,
          });
        }
      });
    }

    const groupedNewAnnotations = drawnAnnotations.reduce((acc, annotation) => {
      const key = `${annotation.document_name}-${annotation.page_number}`;
      if (!acc[key]) {
        acc[key] = {
          page_number: annotation.page_number,
          document_name: annotation.document_name,
          bbox: [],
        };
      }
      acc[key].bbox.push(annotation.bbox);
      return acc;
    }, {});

    Object.values(groupedNewAnnotations).forEach((newGroup) => {
      const existingEntry = savedData.find(
        (entry) =>
          entry.document_name === newGroup.document_name &&
          entry.page_number === newGroup.page_number
      );

      if (existingEntry) {
        existingEntry.bbox.push(...newGroup.bbox);
      } else {
        savedData.push(newGroup);
      }
    });

    setSavedAnnotations(savedData);

    if (onAnnotationAdd) {
      onAnnotationAdd(savedData);
    }

    const totalExistingCountBeforeClear = getCurrentPageExistingBboxes.reduce(
      (count, bboxGroup) => {
        return (
          count +
          bboxGroup.bbox.filter((_, index) => {
            const bboxId = `existing-${bboxGroup.document_name}-${bboxGroup.page_number}-${index}`;
            return !deletedExistingBboxes.has(bboxId);
          }).length
        );
      },
      0
    );

    const drawnCount = drawnAnnotations.length;
    const totalSaved = totalExistingCountBeforeClear + drawnCount;

    setDrawnAnnotations([]);
    setDeletedExistingBboxes(new Set());

    setAnnotationHistoryStack([[]]);
    setAnnotationHistoryIndex(0);
    setExistingBboxHistory([new Set()]);
    setExistingBboxHistoryIndex(0);

    console.log("Annotations saved:", savedData);
    console.log(
      `Successfully saved ${totalSaved} bounding boxes (${totalExistingCountBeforeClear} existing + ${drawnCount} newly drawn)`
    );
  }, [
    boundingBoxes,
    drawnAnnotations,
    deletedExistingBboxes,
    getCurrentPageExistingBboxes,
    onAnnotationAdd,
    isAnnotationToolbarEnabled,
  ]);

  // Handle unsaved changes dialog actions
  const handleUnsavedChangesAction = useCallback(
    (action) => {
      const pendingAction = unsavedChangesDialog.pendingAction;
      setUnsavedChangesDialog({ open: false, pendingAction: null });

      if (action === "save") {
        performSave();
        if (pendingAction) {
          setTimeout(() => pendingAction(), 100);
        }
      } else if (action === "discard") {
        setDrawnAnnotations([]);
        setAnnotationHistoryStack([[]]);
        setAnnotationHistoryIndex(0);
        if (pendingAction) {
          pendingAction();
        }
      }
    },
    [unsavedChangesDialog.pendingAction, performSave]
  );

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (annotationMode === "boundingbox" && isAnnotationToolbarEnabled) {
          setAnnotationMode("none");
        }
      }
    };

    if (annotationMode === "boundingbox" && isAnnotationToolbarEnabled) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [annotationMode, isAnnotationToolbarEnabled]);

  // Beforeunload event listener
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges && isAnnotationToolbarEnabled) {
        e.preventDefault();
        e.returnValue =
          "You have unsaved bounding box annotations. Are you sure you want to leave without saving?";
        return "You have unsaved bounding box annotations. Are you sure you want to leave without saving?";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges, isAnnotationToolbarEnabled]);

  // FIXED: Image preloading function with proper ref usage
  const preloadImages = useCallback(async () => {
    if (!documentData || !documentData.presigned_urls) return;

    // Avoid re-preloading the same dataset
    const preloadKey = JSON.stringify(documentData.presigned_urls);
    if (lastPreloadKeyRef.current === preloadKey) {
      setHasCompletedInitialPreload(true);
      return;
    }
    lastPreloadKeyRef.current = preloadKey;

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
      setHasCompletedInitialPreload(true);
    }
  }, [documentData]);

  // FIXED: Only show loading overlay initially, not during scroll
  const shouldShowLoadingOverlay =
    !hasCompletedInitialPreload && isInitialLoading;

  // FIXED: Improved page tracking from scroll position
  const updateVisiblePageFromScroll = useCallback(() => {
    if (!contentRef.current || isManualNavigationRef.current) return;

    const container = contentRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.top + containerRect.height / 2;

    let closestPage = visiblePageInCenter;
    let smallestDistance = Infinity;

    Object.entries(pageRefs.current).forEach(([pageNumber, el]) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pageCenter = rect.top + rect.height / 2;
      const distance = Math.abs(pageCenter - containerCenter);
      if (distance < smallestDistance) {
        smallestDistance = distance;
        closestPage = Number(pageNumber);
      }
    });

    if (closestPage !== visiblePageInCenter) {
      setVisiblePageInCenter(closestPage);
      setCurrentPage(closestPage);
      onPageChange?.(closestPage);
    }
  }, [visiblePageInCenter, onPageChange]);

  // Smooth scroll function
  const smoothScrollTo = useCallback((targetScroll, duration = 300) => {
    if (!contentRef.current) return;

    const container = contentRef.current;
    const startScroll = container.scrollTop;
    const distance = targetScroll - startScroll;

    if (Math.abs(distance) < 5) {
      container.scrollTop = targetScroll;
      return;
    }

    const startTime = performance.now();

    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
    }

    const animateScroll = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const easeOutCubic = 1 - Math.pow(1 - progress, 3);

      container.scrollTop = startScroll + distance * easeOutCubic;

      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(animateScroll);
      } else {
        scrollAnimationRef.current = null;
      }
    };

    scrollAnimationRef.current = requestAnimationFrame(animateScroll);
  }, []);

  // Direct scroll function
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

  // FIXED: Improved scroll to page function
  const scrollToPage = useCallback(
    (pageNumber) => {
      if (!contentRef.current || !pageRefs.current[pageNumber]) {
        console.warn(`Cannot scroll to page ${pageNumber} - ref not found`);
        return;
      }

      isManualNavigationRef.current = true;

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

      const duration = isSidebarMode ? 400 : 600;
      smoothScrollTo(targetScroll, duration);

      scrollToPageTimeoutRef.current = setTimeout(() => {
        setVisiblePageInCenter(pageNumber);
        setCurrentPage(pageNumber);
        onPageChange?.(pageNumber);

        setTimeout(() => {
          isManualNavigationRef.current = false;
        }, 150);
      }, duration + 50);
    },
    [smoothScrollTo, onPageChange, isSidebarMode]
  );

  // Apply an explicitly requested initial page (e.g., from sidebar "info" click)
  useEffect(() => {
    // Reset the applied marker when file changes so we can re-apply the page
    appliedInitialPageRef.current = null;
  }, [currentFile]);

  useEffect(() => {
    if (!initialPage) return;
    const targetPage = parseInt(initialPage);
    if (isNaN(targetPage) || targetPage < 1) return;

    // Prevent re-applying the same page repeatedly
    if (appliedInitialPageRef.current === targetPage) return;

    setCurrentPage(targetPage);
    setVisiblePageInCenter(targetPage);

    // Slight delay to allow layout refs to settle before scrolling
    setTimeout(() => scrollToPage(targetPage), 50);

    appliedInitialPageRef.current = targetPage;
  }, [initialPage, scrollToPage]);

  // FIXED: Improved intersection observer
  useEffect(() => {
    if (!contentRef.current) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (isManualNavigationRef.current) return;

        if (scrollUpdateTimeoutRef.current) {
          clearTimeout(scrollUpdateTimeoutRef.current);
        }

        scrollUpdateTimeoutRef.current = setTimeout(() => {
          let mostVisiblePage = visiblePageInCenter;
          let highestRatio = 0;

          entries.forEach((entry) => {
            if (
              entry.isIntersecting &&
              entry.intersectionRatio > highestRatio &&
              entry.intersectionRatio >= 0.25
            ) {
              const pageElement = entry.target;
              const pageNumber = parseInt(
                pageElement.dataset.pageNumber || "1"
              );
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
        }, 100);
      },
      {
        root: contentRef.current,
        rootMargin: "-10% 0px -10% 0px",
        threshold: [0.0, 0.25, 0.5, 0.75, 1.0],
      }
    );

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
      if (scrollUpdateTimeoutRef.current) {
        clearTimeout(scrollUpdateTimeoutRef.current);
      }
    };
  }, [currentFile, visiblePageInCenter, onPageChange]);

  // Scroll listener fallback
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    let rafId = null;

    const handleScroll = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        updateVisiblePageFromScroll();
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      container.removeEventListener("scroll", handleScroll);
    };
  }, [updateVisiblePageFromScroll]);

  // Handle initial loading
  useEffect(() => {
    const initTimer = setTimeout(() => {
      setIsInitialLoading(false);
    }, 800);

    preloadImages();

    return () => clearTimeout(initTimer);
  }, [preloadImages]);

  // REMOVED: The problematic force navigation effect that was causing issues

  // Enhanced handleFileChange
  const handleFileChange = useCallback(
    (file, targetPage = 1) => {
      if (
        isAnnotationToolbarEnabled &&
        checkUnsavedChanges(() => {
          setCurrentFile(file);
          setCurrentPage(targetPage);
          setVisiblePageInCenter(targetPage);
          onDocumentChange?.(file);

          setTimeout(() => {
            scrollToPage(targetPage);
          }, 100);
        })
      ) {
        return;
      }

      setCurrentFile(file);
      setCurrentPage(targetPage);
      setVisiblePageInCenter(targetPage);
      onDocumentChange?.(file);

      setTimeout(() => {
        scrollToPage(targetPage);
      }, 100);
    },
    [
      onDocumentChange,
      scrollToPage,
      checkUnsavedChanges,
      isAnnotationToolbarEnabled,
    ]
  );

  // Auto-navigation with flag
  useEffect(() => {
    if (
      !hasAutoNavigatedRef.current &&
      boundingBoxes &&
      Array.isArray(boundingBoxes) &&
      boundingBoxes.length > 0
    ) {
      const firstBbox = boundingBoxes[0];
      if (firstBbox.document_name && firstBbox.page_number) {
        const targetDocument = firstBbox.document_name;
        const targetPage = parseInt(firstBbox.page_number);

        if (documentData.files.includes(targetDocument)) {
          setCurrentFile(targetDocument);
          setTimeout(() => {
            scrollToPage(targetPage);
            hasAutoNavigatedRef.current = true;
          }, 100);
          onDocumentChange?.(targetDocument);
        }
      }
    }
  }, [boundingBoxes, documentData.files, onDocumentChange, scrollToPage]);

  // Auto-navigate to first search result
  useEffect(() => {
    if (searchResults) {
      setIsSearchLoading(false);

      if (
        !searchResults.results ||
        searchResults.results.length === 0 ||
        searchResults.total_matches === 0
      ) {
        setShowNoResults(true);
        setCurrentSearchIndex(-1);

        const noResultsTimer = setTimeout(() => {
          setShowNoResults(false);
        }, 10000);

        return () => clearTimeout(noResultsTimer);
      } else {
        setShowNoResults(false);
        const firstResult = searchResults.results[0];
        setCurrentSearchIndex(0);
        const targetPage = parseInt(firstResult.page_number);

        if (firstResult.document_name !== currentFile) {
          handleFileChange(firstResult.document_name, targetPage);
        } else {
          setTimeout(() => scrollToPage(targetPage), 100);
        }
      }
    }
  }, [searchResults, currentFile, handleFileChange, scrollToPage]);

  // Keyboard navigation
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
          }

          return newSet;
        });
      }
    };

    const handleInitialKeyPress = (e) => {
      if (!contentRef.current) return;

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
  }, [smoothScrollTo, directScroll]);

  // Mouse wheel handler
  useEffect(() => {
    const handleWheel = (e) => {
      if (!contentRef.current) return;

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
  }, []);

  // Scroll to bounding box
  const scrollToBoundingBox = useCallback(
    (bbox, imageWidth, imageHeight) => {
      if (!contentRef.current || !bbox || bbox.length === 0) return;

      const [x1, y1, x2, y2, x3, y3, x4, y4] = bbox[0];
      const left = Math.min(x1, x2, x3, x4) * imageWidth * zoom;
      const top = Math.min(y1, y2, y3, y4) * imageHeight * zoom;
      const width =
        (Math.max(x1, x2, x3, x4) - Math.min(x1, x2, x3, x4)) *
        imageWidth *
        zoom;
      const height =
        (Math.max(y1, y2, y3, y4) - Math.min(y1, y2, y3, y4)) *
        imageHeight *
        zoom;

      const container = contentRef.current;
      const containerRect = container.getBoundingClientRect();

      const centerX = left + width / 2;
      const centerY = top + height / 2;

      const scrollLeft = centerX - containerRect.width / 2;
      const scrollTop = centerY - containerRect.height / 2;

      container.scrollTo({
        left: Math.max(0, scrollLeft),
        top: Math.max(0, scrollTop),
        behavior: "smooth",
      });
    },
    [zoom]
  );

  // FIXED: Handle page change with proper navigation
  const handlePageChange = useCallback(
    (page) => {
      if (page < 1 || page > totalPages || page === currentPage) {
        return;
      }

      // For sidebar mode, just scroll without checks
      if (isSidebarMode) {
        scrollToPage(page);
        return;
      }

      // For annotation mode, check for unsaved changes
      if (isAnnotationToolbarEnabled && hasUnsavedChanges) {
        checkUnsavedChanges(() => {
          scrollToPage(page);
        });
        return;
      }

      // Otherwise, just navigate
      scrollToPage(page);
    },
    [
      totalPages,
      currentPage,
      scrollToPage,
      checkUnsavedChanges,
      isAnnotationToolbarEnabled,
      isSidebarMode,
      hasUnsavedChanges,
    ]
  );

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.25, 0.25));
  }, []);

  const getPageRotation = useCallback(
    (pageNumber) => pageRotations[currentFile]?.[pageNumber] || 0,
    [pageRotations, currentFile]
  );

  const handleRotateLeft = useCallback(() => {
    setPageRotations((prev) => {
      const cur = prev[currentFile]?.[visiblePageInCenter] || 0;
      return {
        ...prev,
        [currentFile]: {
          ...prev[currentFile],
          [visiblePageInCenter]: (cur - 90 + 360) % 360,
        },
      };
    });
  }, [currentFile, visiblePageInCenter]);

  const handleRotateRight = useCallback(() => {
    setPageRotations((prev) => {
      const cur = prev[currentFile]?.[visiblePageInCenter] || 0;
      return {
        ...prev,
        [currentFile]: {
          ...prev[currentFile],
          [visiblePageInCenter]: (cur + 90) % 360,
        },
      };
    });
  }, [currentFile, visiblePageInCenter]);

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

  // Add annotation to history
  const addToAnnotationHistory = useCallback(
    (newAnnotations, newDeletedExisting = deletedExistingBboxes) => {
      setAnnotationHistoryStack((prev) => {
        const newHistory = prev.slice(0, annotationHistoryIndex + 1);
        newHistory.push([...newAnnotations]);
        return newHistory;
      });
      setExistingBboxHistory((prev) => {
        const newHistory = prev.slice(0, existingBboxHistoryIndex + 1);
        newHistory.push(new Set(newDeletedExisting));
        return newHistory;
      });
      setAnnotationHistoryIndex((prev) => prev + 1);
      setExistingBboxHistoryIndex((prev) => prev + 1);
    },
    [annotationHistoryIndex, existingBboxHistoryIndex, deletedExistingBboxes]
  );

  // Handle bounding box creation
  const handleBoundingBoxCreate = useCallback(
    (selectionData) => {
      if (!isAnnotationToolbarEnabled) return;

      const {
        x_min,
        y_min,
        x_max,
        y_max,
        document: documentName,
        page,
      } = selectionData;

      const newAnnotation = {
        id: `bbox-${Date.now()}-${Math.random()}`,
        document_name: documentName,
        page_number: page,
        bbox: [x_min, y_min, x_max, y_max, x_max, y_min, x_min, y_max],
        timestamp: new Date().toISOString(),
      };

      const updatedAnnotations = [...drawnAnnotations, newAnnotation];
      setDrawnAnnotations(updatedAnnotations);
      addToAnnotationHistory(updatedAnnotations);

      console.log("Bounding box created:", newAnnotation);
    },
    [drawnAnnotations, addToAnnotationHistory, isAnnotationToolbarEnabled]
  );

  // Handle individual annotation deletion
  const handleDeleteAnnotation = useCallback(
    (annotationId) => {
      if (!isAnnotationToolbarEnabled) return;

      const updatedAnnotations = drawnAnnotations.filter(
        (ann) => ann.id !== annotationId
      );
      setDrawnAnnotations(updatedAnnotations);
      addToAnnotationHistory(updatedAnnotations);
    },
    [drawnAnnotations, addToAnnotationHistory, isAnnotationToolbarEnabled]
  );

  // Handle existing bounding box deletion
  const handleDeleteExistingBbox = useCallback(
    (bboxId) => {
      if (!isAnnotationToolbarEnabled) return;

      const updatedDeleted = new Set(deletedExistingBboxes);
      updatedDeleted.add(bboxId);
      setDeletedExistingBboxes(updatedDeleted);
      addToAnnotationHistory(drawnAnnotations, updatedDeleted);
    },
    [
      deletedExistingBboxes,
      drawnAnnotations,
      addToAnnotationHistory,
      isAnnotationToolbarEnabled,
    ]
  );

  // Handle annotation mode change
  const handleAnnotationModeChange = useCallback((mode) => {
    setAnnotationMode(mode);
  }, []);

  // Save all annotations
  const handleSaveAnnotations = useCallback(() => {
    if (!isAnnotationToolbarEnabled) return;

    const totalExistingCount = getCurrentPageExistingBboxes.reduce(
      (count, bboxGroup) => {
        return (
          count +
          bboxGroup.bbox.filter((_, index) => {
            const bboxId = `existing-${bboxGroup.document_name}-${bboxGroup.page_number}-${index}`;
            return !deletedExistingBboxes.has(bboxId);
          }).length
        );
      },
      0
    );

    if (totalExistingCount === 0 && drawnAnnotations.length === 0) {
      setConfirmDialog({
        open: true,
        title: "No Annotations to Save",
        message:
          "There are no annotations to save. Please add some bounding boxes first.",
        onConfirm: () => setConfirmDialog((prev) => ({ ...prev, open: false })),
        severity: "info",
      });
      return;
    }

    const totalSaved = totalExistingCount + drawnAnnotations.length;

    setConfirmDialog({
      open: true,
      title: "Save Annotations",
      message: `Are you sure you want to save ${totalSaved} bounding boxes? This will finalize your annotations.`,
      onConfirm: () => {
        performSave();
        setConfirmDialog((prev) => ({ ...prev, open: false }));
      },
      severity: "info",
    });
  }, [
    boundingBoxes,
    drawnAnnotations,
    deletedExistingBboxes,
    getCurrentPageExistingBboxes,
    isAnnotationToolbarEnabled,
    performSave,
  ]);

  // Perform clear all
  const performClearAll = useCallback(() => {
    if (!isAnnotationToolbarEnabled) return;

    const newDeletedSet = new Set(deletedExistingBboxes);

    if (boundingBoxes && Array.isArray(boundingBoxes)) {
      boundingBoxes.forEach((bboxGroup) => {
        if (bboxGroup.document_name === currentFile) {
          bboxGroup.bbox.forEach((_, index) => {
            const bboxId = `existing-${bboxGroup.document_name}-${bboxGroup.page_number}-${index}`;
            newDeletedSet.add(bboxId);
          });
        }
      });
    }

    const emptyAnnotations = drawnAnnotations.filter(
      (ann) => ann.document_name !== currentFile
    );

    setDrawnAnnotations(emptyAnnotations);
    setDeletedExistingBboxes(newDeletedSet);
    addToAnnotationHistory(emptyAnnotations, newDeletedSet);
  }, [
    deletedExistingBboxes,
    boundingBoxes,
    drawnAnnotations,
    currentFile,
    addToAnnotationHistory,
    isAnnotationToolbarEnabled,
  ]);

  // Clear all annotations
  const handleClearAllAnnotations = useCallback(() => {
    if (!isAnnotationToolbarEnabled) return;

    const totalCount = getTotalAnnotationCount();
    if (totalCount === 0) return;

    setConfirmDialog({
      open: true,
      title: "Delete All Annotations",
      message: `Are you sure you want to delete all ${totalCount} annotations in this document? This action cannot be undone.`,
      onConfirm: () => {
        performClearAll();
        setConfirmDialog((prev) => ({ ...prev, open: false }));
      },
      severity: "error",
    });
  }, [getTotalAnnotationCount, isAnnotationToolbarEnabled, performClearAll]);

  // Undo annotation
  const handleUndo = useCallback(() => {
    if (!isAnnotationToolbarEnabled) return;

    if (annotationHistoryIndex > 0) {
      const newIndex = annotationHistoryIndex - 1;
      const newExistingIndex = existingBboxHistoryIndex - 1;

      setAnnotationHistoryIndex(newIndex);
      setExistingBboxHistoryIndex(newExistingIndex);
      setDrawnAnnotations([...annotationHistoryStack[newIndex]]);
      setDeletedExistingBboxes(new Set(existingBboxHistory[newExistingIndex]));
    }
  }, [
    annotationHistoryIndex,
    existingBboxHistoryIndex,
    annotationHistoryStack,
    existingBboxHistory,
    isAnnotationToolbarEnabled,
  ]);

  // Redo annotation
  const handleRedo = useCallback(() => {
    if (!isAnnotationToolbarEnabled) return;

    if (annotationHistoryIndex < annotationHistoryStack.length - 1) {
      const newIndex = annotationHistoryIndex + 1;
      const newExistingIndex = existingBboxHistoryIndex + 1;

      setAnnotationHistoryIndex(newIndex);
      setExistingBboxHistoryIndex(newExistingIndex);
      setDrawnAnnotations([...annotationHistoryStack[newIndex]]);
      setDeletedExistingBboxes(new Set(existingBboxHistory[newExistingIndex]));
    }
  }, [
    annotationHistoryIndex,
    existingBboxHistoryIndex,
    annotationHistoryStack,
    existingBboxHistory,
    isAnnotationToolbarEnabled,
  ]);

  // Search handlers
  const handleSearchChange = useCallback(
    (query) => {
      setSearchQuery(query);
      if (!query.trim()) {
        setCurrentSearchIndex(-1);
        setSearchResults(null);
        setIsSearchLoading(false);
        setShowNoResults(false);
      }
    },
    [setSearchResults]
  );

  const handleSearchSubmit = useCallback(
    (query) => {
      if (query.trim()) {
        setIsSearchLoading(true);
        setShowNoResults(false);
        onSearchPerformed?.(query);
      }
    },
    [onSearchPerformed]
  );

  const handleSearchNavigate = useCallback(
    (direction) => {
      if (!searchResults || !searchResults.results) return;

      const totalMatches = searchResults.total_matches;
      let newIndex = currentSearchIndex;

      if (direction === "next") {
        newIndex = Math.min(currentSearchIndex + 1, totalMatches - 1);
      } else if (direction === "prev") {
        newIndex = Math.max(currentSearchIndex - 1, 0);
      }

      setCurrentSearchIndex(newIndex);

      const currentResult = searchResults.results[newIndex];
      if (currentResult) {
        const targetPage = parseInt(currentResult.page_number);

        if (currentResult.document_name !== currentFile) {
          handleFileChange(currentResult.document_name, targetPage);
        } else {
          scrollToPage(targetPage);
        }
      }
    },
    [
      searchResults,
      currentSearchIndex,
      currentFile,
      handleFileChange,
      scrollToPage,
    ]
  );

  const handleSearchClear = useCallback(() => {
    setSearchQuery("");
    setCurrentSearchIndex(-1);
    setSearchResults(null);
    setIsSearchLoading(false);
    setShowNoResults(false);
  }, [setSearchResults]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) {
              handleRedo();
            } else {
              handleUndo();
            }
            break;
          case "y":
            e.preventDefault();
            handleRedo();
            break;
          case "=":
          case "+":
            e.preventDefault();
            handleZoomIn();
            break;
          case "-":
            e.preventDefault();
            handleZoomOut();
            break;
          case "f": {
            e.preventDefault();
            const searchInput = document.querySelector(
              'input[placeholder*="Search"]'
            );
            if (searchInput) {
              searchInput.focus();
            }
            break;
          }
          case "b": {
            if (isAnnotationToolbarEnabled) {
              e.preventDefault();
              handleAnnotationModeChange(
                annotationMode === "boundingbox" ? "none" : "boundingbox"
              );
            }
            break;
          }
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
            if (isAnnotationToolbarEnabled) {
              setAnnotationMode("none");
            }
            handleSearchClear();
            break;
          case "F3":
            e.preventDefault();
            if (e.shiftKey) {
              handleSearchNavigate("prev");
            } else {
              handleSearchNavigate("next");
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
    handleUndo,
    handleRedo,
    handleSearchNavigate,
    handleSearchClear,
    handleAnnotationModeChange,
    annotationMode,
    isAnnotationToolbarEnabled,
  ]);

  // Cleanup
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
      if (scrollUpdateTimeoutRef.current) {
        clearTimeout(scrollUpdateTimeoutRef.current);
      }
    };
  }, []);

  const containerStyle = {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    position: "relative",
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
    padding: "8px 16px",
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

  if (shouldShowLoadingOverlay) {
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
              Loading PDF Viewer...
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

  return (
    <div style={containerStyle} className={className}>
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
          onRotateLeft={handleRotateLeft}
          onRotateRight={handleRotateRight}
          onDownload={handleDownload}
          documentData={documentData}
          searchQuery={searchQuery}
          searchResults={searchResults}
          currentSearchIndex={currentSearchIndex}
          onSearchChange={handleSearchChange}
          onSearchSubmit={handleSearchSubmit}
          onSearchNavigate={handleSearchNavigate}
          onSearchClear={handleSearchClear}
          userInterfaces={userInterfaces}
          isSearchLoading={isSearchLoading}
        />

        {showNoResults && (
          <div
            style={{
              padding: "8px 16px",
              backgroundColor: "#fef3c7",
              borderLeft: "4px solid #f59e0b",
              borderBottom: "1px solid #e5e7eb",
              fontSize: "14px",
              color: "#92400e",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              animation: "slideInFromTop 0.3s ease-out",
            }}
          >
            <span style={{ fontSize: "16px" }}>🔍</span>
            <span>
              No results found for "{searchQuery}" - try different keywords
            </span>
            <button
              onClick={() => setShowNoResults(false)}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "16px",
                color: "#92400e",
                padding: "0",
                display: "flex",
                alignItems: "center",
                opacity: 0.7,
              }}
              onMouseEnter={(e) => (e.target.style.opacity = "1")}
              onMouseLeave={(e) => (e.target.style.opacity = "0.7")}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {hasUnsavedChanges && isAnnotationToolbarEnabled && (
          <div
            style={{
              padding: "8px 16px",
              backgroundColor: "#fef3c7",
              borderLeft: "4px solid #f59e0b",
              borderBottom: "1px solid #e5e7eb",
              fontSize: "14px",
              color: "#92400e",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              animation: "slideInFromTop 0.3s ease-out",
            }}
          >
            <span style={{ fontSize: "16px" }}>⚠️</span>
            <span>
              You have {drawnAnnotations.length} unsaved bounding box
              {drawnAnnotations.length > 1 ? "es" : ""}. Remember to save your
              changes before navigating away.
            </span>
            <button
              onClick={handleSaveAnnotations}
              style={{
                marginLeft: "auto",
                background: "#f59e0b",
                color: "white",
                border: "none",
                borderRadius: "4px",
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: "bold",
              }}
              onMouseEnter={(e) => (e.target.style.backgroundColor = "#d97706")}
              onMouseLeave={(e) => (e.target.style.backgroundColor = "#f59e0b")}
            >
              Save Now
            </button>
          </div>
        )}
      </div>

      <div style={contentStyle}>
        <AnnotationToolbar
          annotationMode={annotationMode}
          onAnnotationModeChange={handleAnnotationModeChange}
          onSaveAnnotations={handleSaveAnnotations}
          onClearAnnotations={handleClearAllAnnotations}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={annotationHistoryIndex > 0}
          canRedo={annotationHistoryIndex < annotationHistoryStack.length - 1}
          annotationCount={getTotalAnnotationCount()}
          isVisible={isAnnotationToolbarEnabled}
          drawnAnnotations={drawnAnnotations}
          boundingBoxes={boundingBoxes}
          currentDocument={currentFile}
          selectedRegion={selectedRegion}
          onRegionSelect={(regionId) => {
            setSelectedRegion(regionId);
          }}
          onDeleteSelectedRegion={(regionId) => {
            if (regionId.startsWith("existing-")) {
              handleDeleteExistingBbox(regionId);
            } else {
              handleDeleteAnnotation(regionId);
            }
            setSelectedRegion(null);
          }}
          onScrollToRegion={(region) => {
            if (region.type === "existing") {
              const targetPage = region.page;
              if (targetPage !== currentPage) {
                scrollToPage(targetPage);
              }
            } else {
              const targetPage = region.annotation.page_number;
              if (targetPage !== currentPage) {
                scrollToPage(targetPage);
              }
            }
          }}
          deletedExistingBboxes={deletedExistingBboxes}
        />

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

        {annotationMode === "boundingbox" && isAnnotationToolbarEnabled && (
          <div
            style={{
              position: "absolute",
              top: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
            }}
          >
            <div
              style={{
                background: "#4ade80",
                color: "white",
                padding: "8px 16px",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(5, 150, 105, 0.3)",
                border: "1px solid #047857",
                animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "white",
                    borderRadius: "50%",
                    animation: "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
                  }}
                />
                <span style={{ fontSize: "14px", fontWeight: "bold" }}>
                  📦 Draw bounding boxes
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    backgroundColor: "#047857",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    marginLeft: "8px",
                  }}
                >
                  Press ESC to cancel • Ctrl+B toggle
                </span>
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
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
              style={{ fontSize: "14px", color: "#6b7280", marginLeft: "4px" }}
            >
              of {totalPages}
            </span>
          </div>
        </div>

        {userInterfaces?.keyboardShortcuts && (
          <div
            style={{
              position: "absolute",
              bottom: "16px",
              right: "16px",
              zIndex: 10,
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
              {isAnnotationToolbarEnabled && (
                <div style={{ marginBottom: "4px" }}>
                  Ctrl+B Annotate • Ctrl+Z Undo • ESC Cancel
                </div>
              )}
              <div style={{ color: "#fbbf24" }}>
                Hold keys for continuous scroll
              </div>
            </div>
          </div>
        )}

        <div
          ref={contentRef}
          className={
            annotationMode === "boundingbox" && isAnnotationToolbarEnabled
              ? "cursor-none"
              : ""
          }
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
                    borderRadius: "12px",
                    overflow: "hidden",
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
                  <div
                    style={{
                      position: "relative",
                      display: "inline-block",
                      transform: `scale(${zoom}) rotate(${getPageRotation(pageNumber)}deg)`,
                      transformOrigin: "center center",
                      transition: "transform 0.3s ease",
                    }}
                  >
                    <PDFPageRenderer
                      imageUrl={pageUrl}
                      pageNumber={pageNumber}
                      zoom={1}
                      boundingBoxes={boundingBoxes}
                      currentDocument={currentFile}
                      annotationMode={annotationMode}
                      searchResults={searchResults}
                      currentSearchIndex={currentSearchIndex}
                      onScrollToBoundingBox={scrollToBoundingBox}
                      preloadedImages={preloadedImages}
                      isAnnotationMode={
                        annotationMode === "boundingbox" &&
                        isAnnotationToolbarEnabled
                      }
                      onBoundingBoxCreate={handleBoundingBoxCreate}
                      drawnAnnotations={drawnAnnotations}
                      onDeleteAnnotation={handleDeleteAnnotation}
                      deletedExistingBboxes={deletedExistingBboxes}
                      onDeleteExistingBbox={handleDeleteExistingBbox}
                      selectedRegion={selectedRegion}
                    />
                  </div>
                </div>
              );
            })}

            <div style={{ height: "128px" }}></div>
          </div>
        </div>
      </div>

      <div style={statusBarStyle}>
        <div style={statusContentStyle}>
          <span>
            {currentFile} • Page {visiblePageInCenter} of {totalPages} •{" "}
            {Math.round(zoom * 100)}% zoom
            {preloadedImages.size > 0 && (
              <> • {preloadedImages.size} images preloaded</>
            )}
          </span>
          <span></span>
        </div>
      </div>

      {isAnnotationToolbarEnabled && (
        <ConfirmationDialog
          open={confirmDialog.open}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() =>
            setConfirmDialog((prev) => ({ ...prev, open: false }))
          }
          severity={confirmDialog.severity}
          confirmText={confirmDialog.severity === "error" ? "Delete" : "Save"}
          cancelText="Cancel"
        />
      )}

      {isAnnotationToolbarEnabled && (
        <ConfirmationDialog
          open={unsavedChangesDialog.open}
          title="Unsaved Changes"
          message={`You have ${
            drawnAnnotations.length
          } unsaved bounding box annotation${
            drawnAnnotations.length > 1 ? "s" : ""
          }. What would you like to do?`}
          onConfirm={() => handleUnsavedChangesAction("save")}
          onCancel={() => handleUnsavedChangesAction("cancel")}
          severity="warning"
          confirmText="Save & Continue"
          cancelText="Cancel"
          additionalActions={[
            {
              text: "Discard Changes",
              onClick: () => handleUnsavedChangesAction("discard"),
              color: "error",
            },
          ]}
        />
      )}

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
        @keyframes slideInFromTop {
          0% {
            opacity: 0;
            transform: translateY(-10px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .cursor-none {
          cursor: none !important;
        }
        .cursor-none * {
          cursor: none !important;
        }
      `}</style>
    </div>
  );
};
