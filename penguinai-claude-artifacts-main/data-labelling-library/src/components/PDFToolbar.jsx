import {
  Clear as ClearIcon,
  NavigateNext as NextIcon,
  NavigateBefore as PrevIcon,
  RotateLeft as RotateLeftIcon,
  RotateRight as RotateRightIcon,
  Search as SearchIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from "@mui/icons-material";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { Box, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";

export const PDFToolbar = ({
  files,
  currentFile,
  currentPage,
  totalPages,
  zoom,
  onFileChange,
  onPageChange,
  onZoomIn,
  onZoomOut,
  onDownload,
  documentData,
  // Search props
  searchQuery,
  searchResults,
  currentSearchIndex,
  onSearchChange,
  onSearchSubmit,
  onSearchNavigate,
  onSearchClear,
  userInterfaces,
  isSearchLoading = false,
  onRotateLeft,
  onRotateRight,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Add useEffect for outside click detection
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isDropdownOpen]);

  const handlePageInputChange = (e) => {
    const page = parseInt(e.target.value);
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };

  const handleFileSelect = (file) => {
    onFileChange(file);
    setIsDropdownOpen(false);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearchSubmit(searchQuery.trim());
    }
  };

  const handleSearchKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSearchSubmit(e);
    }
  };

  // Generate file data dynamically from documentData
  const getFileData = () => {
    const fileData = {};
    files.forEach((file) => {
      const filePages = documentData?.presigned_urls?.[file] || {};
      const pageCount = Object.keys(filePages).length;
      fileData[file] = {
        pages: pageCount,
        current: currentFile === file,
      };
    });
    return fileData;
  };

  const fileData = getFileData();
  const hasSearchResults =
    searchResults && searchResults.results && searchResults.results.length > 0;
  const totalMatches = searchResults?.total_matches || 0;

  const paperStyle = {
    backgroundColor: "white",
    borderBottom: "1px solid #e0e0e0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
    borderRadius: 0,
  };

  const containerStyle = {
    padding: "12px 10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    border: "1px solid #e4e7eb",
  };

  return (
    <div style={paperStyle}>
      <div style={containerStyle}>
        {/* Left section - Document dropdown */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          {/* File Selection with Dropdown */}
          {/* <Box
            sx={{
              position: "relative",
              minWidth: 200,
            }}
            ref={dropdownRef}
          >
            <Button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              endIcon={isDropdownOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{
                justifyContent: "space-between",
                width: "100%",
                textAlign: "left",
                color: "text.primary",
                border: "1px solid #e0e0e0",
                bgcolor: "white",
                textTransform: "none",
                "&:hover": {
                  bgcolor: "#f5f5f5",
                },
              }}
            >
              <Box>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 600, color: "#111827" }}
                >
                  {currentFile}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Page {currentPage} of {totalPages}
                </Typography>
              </Box>
            </Button>

            <Collapse in={isDropdownOpen}>
              <Paper
                elevation={3}
                sx={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 1000,
                  maxHeight: 300,
                  overflow: "auto",
                  mt: 0.5,
                  border: "1px solid #e0e0e0",
                }}
              >
                <List dense sx={{ py: 0 }}>
                  {Object.entries(fileData).map(
                    ([fileName, fileInfo], index) => (
                      <div key={fileName}>
                        <ListItem
                          button
                          onClick={() => handleFileSelect(fileName)}
                          selected={fileInfo.current}
                          sx={{
                            px: 2,
                            py: 1,
                            "&.Mui-selected": {
                              bgcolor: "transparent",
                              position: "relative",
                              "&::before": {
                                content: '""',
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: "4px",
                                bgcolor: "primary.main",
                                borderRadius: "2px",
                              },
                            },
                            "&:hover": {
                              bgcolor: "#f5f5f5",
                            },
                          }}
                        >
                          <ListItemText
                            primary={
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 600,
                                  color: fileInfo.current
                                    ? "#1c4ed8"
                                    : "inherit",
                                }}
                              >
                                {fileName}
                              </Typography>
                            }
                            secondary={
                              <Typography
                                variant="caption"
                                color={
                                  fileInfo.current
                                    ? "#1c4ed8"
                                    : "text.secondary"
                                }
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 1,
                                }}
                              >
                                <span>{fileInfo.pages} pages</span>
                                {fileInfo.current && (
                                  <>
                                    <span>•</span>
                                    <span style={{ fontWeight: 500 }}>
                                      Current
                                    </span>
                                  </>
                                )}
                              </Typography>
                            }
                            sx={{ my: 0 }}
                          />
                        </ListItem>
                        {index < Object.entries(fileData).length - 1 && (
                          <Divider sx={{ my: 0 }} />
                        )}
                      </div>
                    )
                  )}
                </List>
              </Paper>
            </Collapse>
          </Box> */}

          {(userInterfaces.docNavigation ||
            userInterfaces.zoom ||
            userInterfaces.download) && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                padding: "8px 12px",
                backgroundColor: "white",
                borderRadius: "8px",
                border: "1px solid #e0e0e0",
              }}
            >
              {/* Document Navigation */}
              {userInterfaces.docNavigation && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Doc {files.indexOf(currentFile) + 1} of {files.length}
                  </Typography>
                  <IconButton
                    onClick={() => {
                      const currentIndex = files.indexOf(currentFile);
                      if (currentIndex > 0) {
                        onFileChange(files[currentIndex - 1]);
                      }
                    }}
                    disabled={files.indexOf(currentFile) === 0}
                    size="small"
                  >
                    <PrevIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    onClick={() => {
                      const currentIndex = files.indexOf(currentFile);
                      if (currentIndex < files.length - 1) {
                        onFileChange(files[currentIndex + 1]);
                      }
                    }}
                    disabled={files.indexOf(currentFile) === files.length - 1}
                    size="small"
                  >
                    <NextIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}

              {/* Zoom Controls */}
              {userInterfaces.zoom && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <IconButton
                    onClick={onZoomOut}
                    disabled={zoom <= 0.25}
                    size="small"
                  >
                    <ZoomOutIcon fontSize="small" />
                  </IconButton>
                  <Typography
                    variant="body2"
                    sx={{ minWidth: "48px", textAlign: "center" }}
                  >
                    {Math.round(zoom * 100)}%
                  </Typography>
                  <IconButton
                    onClick={onZoomIn}
                    disabled={zoom >= 3}
                    size="small"
                  >
                    <ZoomInIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}

              {/* Rotation Controls */}
              {userInterfaces.zoom && (onRotateLeft || onRotateRight) && (
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  <Tooltip title="Rotate page left" arrow>
                    <IconButton
                      onClick={onRotateLeft}
                      size="small"
                      sx={{
                        bgcolor: "white",
                        "&:hover": { bgcolor: "#f3f4f6" },
                      }}
                    >
                      <RotateLeftIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Rotate page right" arrow>
                    <IconButton
                      onClick={onRotateRight}
                      size="small"
                      sx={{
                        bgcolor: "white",
                        "&:hover": { bgcolor: "#f3f4f6" },
                      }}
                    >
                      <RotateRightIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}

              {/* Download */}
              {userInterfaces.download && (
                <Tooltip title="Download">
                  <IconButton onClick={onDownload} size="small">
                    <FileDownloadOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}
        </Box>

        {/* Middle section - Search container */}
        {userInterfaces?.enableSearch && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "#f8f9fa",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "8px 16px",
                "&:focus-within": {
                  borderColor: "#3b82f6",
                  backgroundColor: "white",
                },
              }}
            >
              {isSearchLoading ? (
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    border: "2px solid #e5e7eb",
                    borderTop: "2px solid #3b82f6",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    marginRight: "12px",
                  }}
                />
              ) : (
                <SearchIcon
                  fontSize="medium"
                  sx={{ color: "#9ca3af", mr: 1.5 }}
                />
              )}

              <input
                type="text"
                placeholder={
                  isSearchLoading ? "Searching..." : "Search in documents..."
                }
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyPress={handleSearchKeyPress}
                disabled={isSearchLoading}
                style={{
                  border: "none",
                  outline: "none",
                  flex: 1,
                  fontSize: "16px",
                  backgroundColor: "transparent",
                  color: isSearchLoading ? "#9ca3af" : "#111827",
                  fontWeight: "400",
                  cursor: isSearchLoading ? "not-allowed" : "text",
                  minWidth: "300px",
                }}
              />

              <style>
                {`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}
              </style>

              {hasSearchResults && !isSearchLoading && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mr: 2,
                    pl: 2,
                    borderLeft: "1px solid #e5e7eb",
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      color: "#6b7280",
                      fontSize: "14px",
                      fontWeight: "500",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {currentSearchIndex + 1}/{totalMatches}
                  </Typography>

                  <IconButton
                    size="small"
                    onClick={() => onSearchNavigate("prev")}
                    disabled={currentSearchIndex <= 0}
                    sx={{
                      padding: "4px",
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
                    <PrevIcon fontSize="small" />
                  </IconButton>

                  <IconButton
                    size="small"
                    onClick={() => onSearchNavigate("next")}
                    disabled={currentSearchIndex >= totalMatches - 1}
                    sx={{
                      padding: "4px",
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
                    <NextIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}

              {searchQuery && !isSearchLoading && (
                <IconButton
                  size="small"
                  onClick={onSearchClear}
                  sx={{
                    ml: 1,
                    padding: "4px",
                    color: "#9ca3af",
                    "&:hover": {
                      backgroundColor: "#f3f4f6",
                      color: "#374151",
                    },
                  }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          </Box>
        )}

        {/* Page Navigation */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            marginRight: "40px",
          }}
        >
          <IconButton
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            size="small"
            sx={{ p: 0 }}
          >
            <PrevIcon />
          </IconButton>

          <Box sx={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: "#4b5563" }}
            >
              Page
            </Typography>
            <TextField
              size="small"
              value={currentPage}
              onChange={handlePageInputChange}
              inputProps={{
                min: 1,
                max: totalPages,
                style: {
                  textAlign: "center",
                  width: "40px",
                  padding: "6px",
                },
              }}
              type="number"
              variant="outlined"
            />
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: "#4b5563" }}
            >
              of {totalPages}
            </Typography>
          </Box>

          <IconButton
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            size="small"
            sx={{ p: 0 }}
          >
            <NextIcon />
          </IconButton>
        </Box>
      </div>
    </div>
  );
};
