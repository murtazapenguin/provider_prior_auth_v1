import {
  CropDin as BoundingBoxIcon,
  ChevronLeft as CollapseIcon,
  DeleteSweep as DeleteAllIcon,
  Delete as DeleteIcon,
  ChevronRight as ExpandIcon,
  Redo as RedoIcon,
  Save as SaveIcon,
  SelectAll as SelectAllIcon,
  Undo as UndoIcon,
  DeselectOutlined as UnselectAllIcon,
} from "@mui/icons-material";
import {
  Box,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";

export const AnnotationToolbar = ({
  annotationMode,
  onAnnotationModeChange,
  onSaveAnnotations,
  onClearAnnotations,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  annotationCount,
  isVisible = true,
  // New props for region management
  drawnAnnotations = [],
  boundingBoxes = [],
  currentDocument,
  selectedRegion = null,
  onRegionSelect,
  onDeleteSelectedRegion,
  onScrollToRegion,
  deletedExistingBboxes = new Set(),
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const toolbarRef = useRef(null);

  // Click outside to close expanded toolbar
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target)) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isExpanded]);

  if (!isVisible) return null;

  // Get the common label from existing bounding boxes for the current document
  const getDocumentLabel = () => {
    // Check if boundingBoxes is a valid array
    if (
      !boundingBoxes ||
      !Array.isArray(boundingBoxes) ||
      boundingBoxes.length === 0
    ) {
      return "Region"; // Fallback if no existing label found
    }

    // Find the first existing bounding box for this document to get the label
    const existingBbox = boundingBoxes.find(
      (bbox) => bbox.document_name === currentDocument
    );
    if (existingBbox && existingBbox.label && existingBbox.label.length > 0) {
      return existingBbox.label[0];
    }
    return "Region"; // Fallback if no existing label found
  };

  // Updated function to get all regions with proper labels
  const getAllRegions = () => {
    const regions = [];
    const documentLabel = getDocumentLabel();

    // Add drawn annotations (filter by current document and page) - use same label as existing
    drawnAnnotations.forEach((annotation, index) => {
      if (annotation.document_name === currentDocument) {
        regions.push({
          id: annotation.id,
          type: "drawn",
          label: documentLabel, // Use the same label as existing regions
          page: annotation.page_number,
          annotation: annotation,
        });
      }
    });

    // Add existing bounding boxes - check if boundingBoxes is valid array
    if (boundingBoxes && Array.isArray(boundingBoxes)) {
      boundingBoxes.forEach((bboxGroup) => {
        bboxGroup.bbox.forEach((bbox, bboxIndex) => {
          const bboxId = `existing-${bboxGroup.document_name}-${bboxGroup.page_number}-${bboxIndex}`;
          if (!deletedExistingBboxes.has(bboxId)) {
            // Extract label from the bboxGroup data
            const label =
              bboxGroup.label && bboxGroup.label.length > 0
                ? bboxGroup.label[0] // Use the first label from the array
                : `Region ${bboxIndex + 1}`;

            regions.push({
              id: bboxId,
              type: "existing",
              label: label,
              page: parseInt(bboxGroup.page_number),
              bbox: bbox,
              bboxGroup: bboxGroup,
              bboxIndex: bboxIndex,
            });
          }
        });
      });
    }

    return regions.sort((a, b) => a.page - b.page);
  };

  const allRegions = getAllRegions();
  const totalRegions = allRegions.length;

  // Check if all regions are selected (for select all/unselect all logic)
  const hasSelection = selectedRegion !== null;
  const allRegionsOnCurrentPage = allRegions.filter(
    (region) =>
      (region.type === "drawn" &&
        region.annotation.document_name === currentDocument) ||
      (region.type === "existing" &&
        region.bboxGroup.document_name === currentDocument)
  );

  const toolbarStyle = {
    position: "absolute",
    top: "30%",
    right: "16px",
    transform: "translateY(-50%)",
    zIndex: 1000,
    backgroundColor: "white",
    borderRadius: "12px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
    border: "1px solid #e5e7eb",
    padding: "8px",
    display: "flex",
    flexDirection: "row",
    gap: "8px",
    minWidth: isExpanded ? "320px" : "56px",
    maxHeight: "70vh",
    transition: "all 0.3s ease-in-out",
  };

  const buttonStyle = {
    minWidth: "40px",
    width: "40px",
    height: "40px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const activeButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#059669",
    color: "white",
    "&:hover": {
      backgroundColor: "#047857",
    },
  };

  const inactiveButtonStyle = {
    ...buttonStyle,
    backgroundColor: "transparent",
    color: "#6b7280",
    "&:hover": {
      backgroundColor: "#f3f4f6",
      color: "#374151",
    },
  };

  const handleRegionClick = (region) => {
    if (onRegionSelect) {
      onRegionSelect(region.id);
    }
    if (onScrollToRegion) {
      onScrollToRegion(region);
    }
  };

  const handleDeleteRegion = (regionId, event) => {
    event.stopPropagation(); // Prevent region selection when clicking delete
    if (onDeleteSelectedRegion) {
      onDeleteSelectedRegion(regionId);
    }
  };

  // Handle select all - cycle through regions or clear selection
  const handleSelectAll = () => {
    if (allRegionsOnCurrentPage.length === 0) return;

    // If nothing is selected, select the first region
    if (!selectedRegion) {
      const firstRegion = allRegionsOnCurrentPage[0];
      if (onRegionSelect && firstRegion) {
        onRegionSelect(firstRegion.id);
        if (onScrollToRegion) {
          onScrollToRegion(firstRegion);
        }
      }
    } else {
      // Find current selected region index and select next one
      const currentIndex = allRegionsOnCurrentPage.findIndex(
        (region) => region.id === selectedRegion
      );
      const nextIndex = (currentIndex + 1) % allRegionsOnCurrentPage.length;
      const nextRegion = allRegionsOnCurrentPage[nextIndex];

      if (onRegionSelect && nextRegion) {
        onRegionSelect(nextRegion.id);
        if (onScrollToRegion) {
          onScrollToRegion(nextRegion);
        }
      }
    }
  };

  // Handle unselect all
  const handleUnselectAll = () => {
    if (onRegionSelect) {
      onRegionSelect(null);
    }
  };

  return (
    <Paper ref={toolbarRef} style={toolbarStyle} elevation={0}>
      {/* Main Toolbar */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {/* Expand/Collapse Button */}
        <Tooltip
          title={isExpanded ? "Collapse Toolbar" : "Expand Toolbar"}
          placement="left"
        >
          <IconButton
            onClick={() => setIsExpanded(!isExpanded)}
            sx={inactiveButtonStyle}
          >
            {isExpanded ? (
              <CollapseIcon fontSize="small" />
            ) : (
              <ExpandIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>

        <Divider sx={{ my: 1 }} />

        {/* Annotation Mode Button */}
        <Tooltip
          title={
            annotationMode === "boundingbox"
              ? "Exit Drawing Mode"
              : "Draw Bounding Box"
          }
          placement="left"
        >
          <IconButton
            onClick={() =>
              onAnnotationModeChange(
                annotationMode === "boundingbox" ? "none" : "boundingbox"
              )
            }
            sx={
              annotationMode === "boundingbox"
                ? activeButtonStyle
                : inactiveButtonStyle
            }
          >
            <BoundingBoxIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Divider sx={{ my: 1 }} />

        {/* Action Buttons */}
        <Tooltip title="Undo Last Action" placement="left">
          <IconButton
            onClick={onUndo}
            disabled={!canUndo}
            sx={{
              ...inactiveButtonStyle,
              opacity: canUndo ? 1 : 0.5,
            }}
          >
            <UndoIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Redo Last Action" placement="left">
          <IconButton
            onClick={onRedo}
            disabled={!canRedo}
            sx={{
              ...inactiveButtonStyle,
              opacity: canRedo ? 1 : 0.5,
            }}
          >
            <RedoIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Divider sx={{ my: 1 }} />

        {/* Save and Clear All */}
        <Tooltip title="Save/Update Annotations" placement="left">
          <IconButton
            onClick={onSaveAnnotations}
            disabled={totalRegions === 0}
            sx={{
              ...inactiveButtonStyle,
              opacity: totalRegions > 0 ? 1 : 0.5,
              color: totalRegions > 0 ? "#059669" : "#6b7280",
              "&:hover": {
                backgroundColor: totalRegions > 0 ? "#ecfdf5" : "#f3f4f6",
                color: totalRegions > 0 ? "#047857" : "#374151",
              },
            }}
          >
            <SaveIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Delete All Regions" placement="left">
          <IconButton
            onClick={onClearAnnotations}
            disabled={totalRegions === 0}
            sx={{
              ...inactiveButtonStyle,
              opacity: totalRegions > 0 ? 1 : 0.5,
              color: totalRegions > 0 ? "#dc2626" : "#6b7280",
              "&:hover": {
                backgroundColor: totalRegions > 0 ? "#fef2f2" : "#f3f4f6",
                color: totalRegions > 0 ? "#b91c1c" : "#374151",
              },
            }}
          >
            <DeleteAllIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Region Count */}
        {totalRegions > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ textAlign: "center", px: 1 }}>
              <Typography
                variant="caption"
                sx={{
                  fontSize: "10px",
                  color: "#059669",
                  fontWeight: "600",
                }}
              >
                {totalRegions}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontSize: "9px",
                  color: "#9ca3af",
                  display: "block",
                  lineHeight: 1,
                }}
              >
                regions
              </Typography>
            </Box>
          </>
        )}
      </Box>

      {/* Expanded Panel - Region List */}
      {isExpanded && (
        <Box
          sx={{
            width: "100%",
            borderLeft: "1px solid #e5e7eb",
            paddingLeft: "8px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header with Select/Unselect All */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 1,
              px: 1,
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: "600",
                color: "#374151",
              }}
            >
              Regions ({totalRegions})
            </Typography>

            {/* Select All / Unselect All Buttons */}
            {totalRegions > 0 && (
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <Tooltip title="Cycle Through Regions" placement="top">
                  <IconButton
                    size="small"
                    onClick={handleSelectAll}
                    disabled={allRegionsOnCurrentPage.length === 0}
                    sx={{
                      width: "24px",
                      height: "24px",
                      color: "#059669",
                      "&:hover": {
                        backgroundColor: "#ecfdf5",
                        color: "#047857",
                      },
                      "&:disabled": {
                        color: "#d1d5db",
                      },
                    }}
                  >
                    <SelectAllIcon sx={{ fontSize: "16px" }} />
                  </IconButton>
                </Tooltip>

                <Tooltip title="Unselect All" placement="top">
                  <IconButton
                    size="small"
                    onClick={handleUnselectAll}
                    disabled={!hasSelection}
                    sx={{
                      width: "24px",
                      height: "24px",
                      color: "#6b7280",
                      "&:hover": {
                        backgroundColor: "#f3f4f6",
                        color: "#374151",
                      },
                      "&:disabled": {
                        color: "#d1d5db",
                      },
                    }}
                  >
                    <UnselectAllIcon sx={{ fontSize: "16px" }} />
                  </IconButton>
                </Tooltip>
              </Box>
            )}
          </Box>

          {totalRegions === 0 ? (
            <Box
              sx={{
                textAlign: "center",
                py: 3,
                color: "#9ca3af",
              }}
            >
              <Typography variant="body2" sx={{ fontSize: "12px" }}>
                No regions found
              </Typography>
              <Typography variant="caption" sx={{ fontSize: "10px" }}>
                Draw bounding boxes to create regions
              </Typography>
            </Box>
          ) : (
            <List
              sx={{
                maxHeight: "300px",
                overflowY: "auto",
                py: 0,
                "&::-webkit-scrollbar": {
                  width: "4px",
                },
                "&::-webkit-scrollbar-track": {
                  backgroundColor: "#f3f4f6",
                  borderRadius: "2px",
                },
                "&::-webkit-scrollbar-thumb": {
                  backgroundColor: "#d1d5db",
                  borderRadius: "2px",
                  "&:hover": {
                    backgroundColor: "#9ca3af",
                  },
                },
              }}
            >
              {allRegions.map((region, index) => (
                <ListItem key={region.id} sx={{ px: 0, py: 0.5 }}>
                  <ListItemButton
                    onClick={() => handleRegionClick(region)}
                    selected={selectedRegion === region.id}
                    sx={{
                      borderRadius: "6px",
                      py: 1,
                      px: 1.5,
                      "&.Mui-selected": {
                        backgroundColor: "#fefce8",
                        border: "1px solid #eab308",
                        "&:hover": {
                          backgroundColor: "#fef3c7",
                        },
                      },
                      "&:hover": {
                        backgroundColor: "#f9fafb",
                      },
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            justifyContent: "space-between",
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              flex: 1,
                            }}
                          >
                            <Box
                              sx={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                backgroundColor:
                                  region.type === "drawn"
                                    ? "#059669"
                                    : "#3b82f6",
                                flexShrink: 0,
                              }}
                            />
                            <Typography
                              variant="body2"
                              sx={{
                                fontSize: "12px",
                                fontWeight: "500",
                                color: "#374151",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: 1,
                              }}
                            >
                              {region.label}
                            </Typography>
                          </Box>

                          {/* Individual Delete Button */}
                          <IconButton
                            size="small"
                            onClick={(e) => handleDeleteRegion(region.id, e)}
                            sx={{
                              width: "20px",
                              height: "20px",
                              color: "#dc2626",
                              opacity: selectedRegion === region.id ? 1 : 0.6,
                              transition: "all 0.2s ease",
                              "&:hover": {
                                backgroundColor: "#fef2f2",
                                color: "#b91c1c",
                                opacity: 1,
                              },
                            }}
                          >
                            <DeleteIcon sx={{ fontSize: "14px" }} />
                          </IconButton>
                        </Box>
                      }
                      secondary={
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: "10px",
                            color: "#6b7280",
                            ml: 2,
                          }}
                        >
                          Page {region.page} •{" "}
                          {region.type === "drawn" ? "New" : "Saved"}
                        </Typography>
                      }
                      sx={{ my: 0 }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      )}
    </Paper>
  );
};
