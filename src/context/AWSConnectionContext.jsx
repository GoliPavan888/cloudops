import { createContext, useContext, useMemo, useState } from "react";
import { clearConnectedRole, getConnectedRole, setConnectedRole as persistConnectedRole } from "../utils/awsConnection";

const AWSConnectionContext = createContext(null);

const CACHE_KEYS = [
	"awsUsers",
	"awsResources",
	"awsMetrics",
	"awsEc2Instances",
	"awsS3Buckets",
	"awsRDSDatabases",
	"awsLambdaFunctions",
	"awsIAMInventory",
	"awsDynamoDBTables",
	"awsSQSQueues",
];

export function AWSConnectionProvider({ children }) {
	const [connectedRole, setConnectedRoleState] = useState(() => getConnectedRole());

	const setConnectedRole = (value) => {
		const normalized = persistConnectedRole(value);
		setConnectedRoleState(normalized);
		return normalized;
	};

	const disconnectAWS = () => {
		clearConnectedRole();
		CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
		setConnectedRoleState(null);
		window.location.assign("/");
	};

	const value = useMemo(
		() => ({
			connectedRole,
			setConnectedRole,
			disconnectAWS,
		}),
		[connectedRole]
	);

	return <AWSConnectionContext.Provider value={value}>{children}</AWSConnectionContext.Provider>;
}

export function useAWSConnection() {
	const context = useContext(AWSConnectionContext);
	if (!context) {
		throw new Error("useAWSConnection must be used within AWSConnectionProvider");
	}
	return context;
}