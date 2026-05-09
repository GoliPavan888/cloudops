const CONNECTION_KEY = "connectedRole";

function inferEnvironmentType(accountAlias = "", roleName = "", accountId = "") {
	const candidate = `${accountAlias} ${roleName} ${accountId}`.toLowerCase();

	if (/(security|secops|guard|audit|log[-_ ]archive)/.test(candidate)) return "Security";
	if (/(prod|production|live|main|core)/.test(candidate)) return "Production";
	if (/(sandbox|lab|test|qa|dev|development|demo|uat|stage|staging)/.test(candidate)) return "Sandbox";
	if (/(engineering|builder|nonprod|shared-services|shared services)/.test(candidate)) return "Development";

	return "Development";
}

function normalizeConnectedRole(value) {
	if (!value || typeof value !== "object") return null;

	const activeAccount = value.activeAccount && typeof value.activeAccount === "object" ? value.activeAccount : null;
	const roleArn = value.roleArn || activeAccount?.roleArn || "";
	const accountId = value.accountId || activeAccount?.accountId || (roleArn ? roleArn.split(":")[4] : "") || "";
	const accountAlias = value.accountAlias || activeAccount?.accountAlias || "";
	const region = value.region || activeAccount?.region || "us-east-1";
	const connectedAt = value.connectedAt || activeAccount?.connectedAt || new Date().toISOString();
	const roleName = value.roleName || activeAccount?.roleName || (roleArn ? roleArn.split("/").pop() : "") || "UnknownRole";
	const assumedRoleArn = value.assumedRoleArn || activeAccount?.assumedRoleArn || "";
	const environmentType = value.environmentType || activeAccount?.environmentType || inferEnvironmentType(accountAlias, roleName, accountId);
	const connectionHealth = value.connectionHealth || activeAccount?.connectionHealth || (roleArn && accountId ? "Connected" : "Unknown");

	const normalized = {
		...value,
		roleArn,
		accountId,
		accountAlias,
		region,
		roleName,
		assumedRoleArn,
		environmentType,
		connectionHealth,
		connectedAt,
	};

	if (Array.isArray(value.accounts)) {
		normalized.accounts = value.accounts;
	}

	if (activeAccount || normalized.accounts) {
		normalized.activeAccount = activeAccount || {
			roleArn,
			accountId,
			accountAlias,
			region,
			roleName,
			assumedRoleArn,
			environmentType,
			connectionHealth,
			connectedAt,
		};
	}

	return normalized;
}

export const getConnectedRole = () => {
	try {
		const data = localStorage.getItem(CONNECTION_KEY);
		return data ? normalizeConnectedRole(JSON.parse(data)) : null;
	} catch {
		return null;
	}
};

export const setConnectedRole = (value) => {
	const normalized = normalizeConnectedRole(value);
	if (!normalized) return null;
	localStorage.setItem(CONNECTION_KEY, JSON.stringify(normalized));
	return normalized;
};

export const clearConnectedRole = () => {
	localStorage.removeItem(CONNECTION_KEY);
};

export const validateConnectedRole = (value) => {
	const role = value ? normalizeConnectedRole(value) : getConnectedRole();
	return Boolean(role?.roleArn && role?.accountId && role?.region);
};

export const normalizeAWSConnection = normalizeConnectedRole;
export const inferAWSConnectionEnvironment = inferEnvironmentType;