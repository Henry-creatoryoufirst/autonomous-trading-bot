#!/bin/bash
# Henry's Trading Agent Control Script
# Usage: ./trading-agent.sh [start|stop|restart|status|logs]

PLIST_NAME="com.henry.trading-agent"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
SOURCE_PLIST="$HOME/Desktop/autonomous-agent/com.henry.trading-agent.plist"
LOG_DIR="$HOME/Desktop/autonomous-agent/logs"
LOG_FILE="$LOG_DIR/agent.log"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

case "$1" in
    install)
        echo -e "${YELLOW}🔧 Installing trading agent service...${NC}"

        # Create logs directory
        mkdir -p "$LOG_DIR"

        # Copy plist to LaunchAgents
        cp "$SOURCE_PLIST" "$PLIST_PATH"

        # Load the service
        launchctl load "$PLIST_PATH"

        echo -e "${GREEN}✅ Trading agent installed and started!${NC}"
        echo -e "   Logs: $LOG_FILE"
        echo -e "   Use './trading-agent.sh status' to check"
        ;;

    start)
        echo -e "${YELLOW}🚀 Starting trading agent...${NC}"
        launchctl start "$PLIST_NAME"
        sleep 2
        if launchctl list | grep -q "$PLIST_NAME"; then
            echo -e "${GREEN}✅ Trading agent started!${NC}"
        else
            echo -e "${RED}❌ Failed to start. Check logs: $LOG_FILE${NC}"
        fi
        ;;

    stop)
        echo -e "${YELLOW}🛑 Stopping trading agent...${NC}"
        launchctl stop "$PLIST_NAME"
        echo -e "${GREEN}✅ Trading agent stopped${NC}"
        ;;

    restart)
        echo -e "${YELLOW}🔄 Restarting trading agent...${NC}"
        launchctl stop "$PLIST_NAME"
        sleep 2
        launchctl start "$PLIST_NAME"
        echo -e "${GREEN}✅ Trading agent restarted${NC}"
        ;;

    uninstall)
        echo -e "${YELLOW}🗑️ Uninstalling trading agent service...${NC}"
        launchctl stop "$PLIST_NAME" 2>/dev/null
        launchctl unload "$PLIST_PATH" 2>/dev/null
        rm -f "$PLIST_PATH"
        echo -e "${GREEN}✅ Trading agent uninstalled${NC}"
        ;;

    status)
        echo -e "${YELLOW}📊 Trading Agent Status${NC}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        if launchctl list | grep -q "$PLIST_NAME"; then
            PID=$(launchctl list | grep "$PLIST_NAME" | awk '{print $1}')
            if [ "$PID" != "-" ] && [ -n "$PID" ]; then
                echo -e "Status: ${GREEN}● Running${NC} (PID: $PID)"
            else
                echo -e "Status: ${YELLOW}● Loaded but not running${NC}"
            fi
        else
            echo -e "Status: ${RED}● Not running${NC}"
        fi

        echo ""
        echo "Recent activity (last 10 lines):"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        if [ -f "$LOG_FILE" ]; then
            tail -10 "$LOG_FILE"
        else
            echo "No logs yet"
        fi
        ;;

    logs)
        echo -e "${YELLOW}📜 Trading Agent Logs (live)${NC}"
        echo "Press Ctrl+C to exit"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        tail -f "$LOG_FILE"
        ;;

    logs-error)
        echo -e "${RED}📜 Trading Agent Error Logs${NC}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        cat "$LOG_DIR/agent-error.log"
        ;;

    *)
        echo "🤖 Henry's Trading Agent Control"
        echo ""
        echo "Usage: $0 {install|start|stop|restart|status|logs|logs-error|uninstall}"
        echo ""
        echo "Commands:"
        echo "  install    - Install and start the agent as a background service"
        echo "  start      - Start the agent"
        echo "  stop       - Stop the agent"
        echo "  restart    - Restart the agent"
        echo "  status     - Show agent status and recent activity"
        echo "  logs       - Follow live logs"
        echo "  logs-error - Show error logs"
        echo "  uninstall  - Remove the background service"
        ;;
esac
