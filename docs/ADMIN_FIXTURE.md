# Admin panel fixture

The fixture runs the real `AdminPanel` against a local mock API. It does not start
the backend, read `.env`, use a configured `VITE_API_URL`, or contact a live
environment. Its Vite server binds to `127.0.0.1:5194`, and it forces the mock
API origin to that same loopback address. All fixture emails use
`example.invalid`; account UUIDs and activity are synthetic.

Start it from the repository root:

```bash
npm run admin:fixture
```

Open `http://127.0.0.1:5194/admin-fixture.html?mode=allowed`. Keep the terminal
open while using the panel. Stop the fixture with Ctrl+C.

The scenario selector supports:

- **Quản trị được phép**: opens the real panel against the mock service. Search
  for `00000000-0000-4000-8000-000000000001` to verify exact UUID lookup, the
  audit pager, the account report filter, and the account CSV label. Search for
  `learner-02@example.invalid` to see bootstrap controls disabled. Search for
  `admin.fixture@example.invalid` to see the signed-in fixture account controls
  disabled. There are 55 synthetic accounts, 33 groups, 57 sessions per scoped
  result, and 30 audit entries on the first account, so the existing pagers have
  more than one page.
- **Từ chối trước khi mở panel**: shows the denied-access state.
- **Mất kết nối API**: makes mock API requests fail at the network layer. Return
  to the allowed scenario and use the panel's retry buttons.
- **Quyền bị thu hồi**: returns a server 403 to the mounted panel; the panel
  clears its data and hands control back to the denied-access state.

For a single failed request, choose **Lỗi API kế tiếp**, then retry the failed
report, account, group, session, or audit request. To check mutation revocation,
leave the allowed scenario selected, find a non-bootstrap account, choose
**Thu hồi khi xác nhận sửa**, then open a confirmation, enter a short reason,
and confirm. The fixture replies 403 to that PUT; the panel clears
admin data and displays the denied state.

The CSV buttons download a mock CSV whose `accountId` or `groupId` column
reflects the current selection. Account and group reports, session pages, and
audit history are filtered from the selected target. No fixture action writes
outside the in-memory mock service.

Use **Chỉnh sửa tên**, enter a new display name and a reason, and confirm to
check the name transition in audit history. **Xóa tài khoản** preserves mock
study history and revokes its admin grant. Only recovery remains enabled on
the deleted target; restoring does not reinstate its grant. To reproduce a
stale-version conflict, open the same account in two fixture tabs and change
it in one before confirming a change in the other.

The **Giao diện** selector switches light/dark themes. Check the panel and its
confirmation dialog at 1440, 768, and 390 pixels, including long Vietnamese
names, disabled self/bootstrap controls, and the network/permission errors.
