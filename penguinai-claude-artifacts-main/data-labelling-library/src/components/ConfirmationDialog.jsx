import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

export const ConfirmationDialog = ({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  severity = "warning", // 'warning', 'error', 'info'
}) => {
  const getIconAndColor = () => {
    switch (severity) {
      case "error":
        return { icon: "🚨", color: "#dc2626" };
      case "warning":
        return { icon: "⚠️", color: "#f59e0b" };
      case "info":
        return { icon: "ℹ️", color: "#3b82f6" };
      default:
        return { icon: "⚠️", color: "#f59e0b" };
    }
  };

  const { icon, color } = getIconAndColor();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: "12px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "18px",
          fontWeight: "600",
          color: "#111827",
          pb: 1,
        }}
      >
        <span style={{ fontSize: "24px" }}>{icon}</span>
        {title}
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <DialogContentText
          sx={{
            fontSize: "15px",
            lineHeight: "1.6",
            color: "#374151",
          }}
        >
          {message}
        </DialogContentText>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 2, gap: 1 }}>
        <Button
          onClick={onCancel}
          variant="outlined"
          sx={{
            borderRadius: "8px",
            textTransform: "none",
            fontWeight: "500",
            minWidth: "80px",
            borderColor: "#d1d5db",
            color: "#374151",
            "&:hover": {
              borderColor: "#9ca3af",
              backgroundColor: "#f9fafb",
            },
          }}
        >
          {cancelText}
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          sx={{
            borderRadius: "8px",
            textTransform: "none",
            fontWeight: "500",
            minWidth: "80px",
            backgroundColor: color,
            "&:hover": {
              backgroundColor:
                severity === "error"
                  ? "#b91c1c"
                  : severity === "warning"
                  ? "#d97706"
                  : "#2563eb",
            },
          }}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
